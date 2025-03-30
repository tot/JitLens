import base64
import datetime
import os
import threading
from typing import Generator

import openai
import PIL.Image
from openai.types.chat import ChatCompletionMessageParam


def _image_to_base64(image: PIL.Image.Image):
    return "data:image/png;base64," + base64.b64encode(image.tobytes()).decode("utf-8")


class Context:
    def __init__(
        self,
        log_dir: str,
        openai_client: openai.OpenAI,
        prompt_history_length_s: float = 30,
        max_finegrained_prompt_length_s: float = 30,
    ):
        self.log_dir = log_dir
        self.running = False
        self.content_id_counter = 0
        self.indexing_queue = []
        self.content = []
        self.indexing_thread = None
        self.openai_client = openai_client
        self.prompt_history_length_s = prompt_history_length_s
        self.max_finegrained_prompt_length_s = max_finegrained_prompt_length_s

    def launch(self):
        self.running = True
        self.indexing_thread = threading.Thread(target=self._indexing_thread_loop)
        self.indexing_thread.start()

    def shutdown(self):
        self.running = False
        if self.indexing_thread:
            self.indexing_thread.join()
        self.indexing_thread = None

    def _create_caption(self, image: PIL.Image.Image) -> str:
        response = self.openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You create detailed descriptions of images for future lookup.",
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Please describe the image in detail. Only respond with the description.",
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": _image_to_base64(image)},
                        },
                    ],
                },
            ],
        )
        caption = response.choices[0].message.content
        assert caption is not None

        return caption

    def _indexing_thread_loop(self):
        while self.running:
            while self.indexing_queue:
                item = self.indexing_queue.pop(0)
                item["image"].save(f"{self.log_dir}/{item['id']}.png")

                if not os.path.exists(f"{self.log_dir}/{item['index']}_caption.txt"):
                    caption = self._create_caption(item["image"])
                    with open(f"{self.log_dir}/{item['id']}_caption.txt", "w") as f:
                        f.write(caption)

    def add_image(self, image: PIL.Image.Image, timestamp: datetime.datetime):
        self.indexing_queue.append(
            {
                "type": "image",
                "role": "user",
                "image": image,
                "id": self.content_id_counter,
                "timestamp": timestamp.timestamp(),
            }
        )
        self.content.append(
            {
                "type": "image",
                "role": "user",
                "image": image,
                "id": self.content_id_counter,
                "timestamp": timestamp.timestamp(),
            }
        )
        self.content_id_counter += 1

    def add_speech(self, speech: str, timestamp: datetime.datetime):
        self.content.append(
            {
                "type": "text",
                "role": "user",
                "text": speech,
                "id": self.content_id_counter,
                "timestamp": timestamp.timestamp(),
            }
        )
        self.content_id_counter += 1

    def add_function_call_request(
        self,
        name: str,
        parameters: dict,
        tool_call_id: str,
        timestamp: datetime.datetime,
    ):
        self.content.append(
            {
                "type": "function_call_request",
                "role": "assistant",
                "name": name,
                "parameters": parameters,
                "id": self.content_id_counter,
                "tool_call_id": tool_call_id,
                "timestamp": timestamp.timestamp(),
            }
        )
        self.content_id_counter += 1

    def add_function_call_response(
        self,
        tool_call_id: str,
        response_structured: dict,
        response_formatted: str,
        timestamp: datetime.datetime,
    ):
        self.content.append(
            {
                "type": "function_call_response",
                "role": "assistant",
                "response_structured": response_structured,
                "response_formatted": response_formatted,
                "id": self.content_id_counter,
                "tool_call_id": tool_call_id,
                "timestamp": timestamp.timestamp(),
            }
        )
        self.content_id_counter += 1

    def get_latest_finegrained_context(self):
        end_time = datetime.datetime.now()
        start_time = end_time - datetime.timedelta(seconds=self.prompt_history_length_s)
        return self._construct_finegrained_context(start_time, end_time)

    def _construct_finegrained_context(
        self, start_time: datetime.datetime, end_time: datetime.datetime
    ):
        if (
            end_time - start_time
        ).total_seconds() > self.max_finegrained_prompt_length_s:
            raise ValueError(
                "The time range is too long for a fine-grained prompt. "
                "Please reduce the time range."
            )

        prompt: list[ChatCompletionMessageParam] = []
        for item in self.content:
            if not (
                item["timestamp"] >= start_time.timestamp()
                and item["timestamp"] <= end_time.timestamp()
            ):
                continue

            match item["type"]:
                case "image":
                    # Squeeze consecutive messages from same role into one.
                    if len(prompt) > 0 and prompt[-1]["role"] == item["role"]:
                        prompt[-1]["content"].append(  # type: ignore
                            {
                                "type": "image_url",
                                "image_url": {"url": _image_to_base64(item["image"])},
                            }
                        )
                        continue

                    prompt.append(
                        {
                            "role": item["role"],  # This can only be 'user'.
                            "content": [
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": _image_to_base64(item["image"])
                                    },
                                }
                            ],
                        }
                    )
                case "text":
                    if len(prompt) > 0:
                        if prompt[-1]["role"] == item["role"]:
                            if prompt[-1]["content"][0]["type"] == "text":  # type: ignore
                                # Concatenate consecutive text messages into one.
                                prompt[-1]["content"][0]["text"] += item["text"]  # type: ignore
                            else:
                                # Append text content piece to the last message.
                                prompt[-1]["content"].append(  # type: ignore
                                    {"type": "text", "text": item["text"]}
                                )
                            continue

                    prompt.append(
                        {
                            "role": item["role"],
                            "content": [
                                {"type": "text", "text": item["text"]},
                            ],
                        }
                    )
                case "function_call_request":
                    prompt.append(
                        {
                            "role": item["role"],
                            "content": [
                                {"type": "text", "text": item["text"]},
                            ],
                        }
                    )
                case "function_call_response":
                    prompt.append(
                        {
                            "role": item["role"],
                            "content": item["response_formatted"],
                            "tool_call_id": item["tool_call_id"],
                        }
                    )
                case _:
                    raise ValueError(f"Unknown content type: {item['type']}")

        return prompt
