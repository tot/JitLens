import asyncio
import base64
import datetime
import json
import io
import os

from loguru import logger
import openai
import PIL.Image
from openai.types.chat import ChatCompletionMessageParam


def _image_to_base64(image: PIL.Image.Image):
    io_save = io.BytesIO()
    image.save(io_save, format="PNG")
    io_save.seek(0)
    return "data:image/png;base64," + base64.b64encode(io_save.read()).decode("utf-8")


class Context:
    def __init__(
        self,
        log_dir: str,
        openai_client: openai.AsyncOpenAI,
        prompt_history_length_s: float = 30,
        max_finegrained_prompt_length_s: float = 30,
    ):
        self.log_dir = log_dir
        self.content_id_counter = 0
        self.indexing_queue = asyncio.Queue()
        self.content = []
        self.indexing_tasks = []
        self.indexing_thread = None
        self.openai_client = openai_client
        self.prompt_history_length_s = prompt_history_length_s
        self.max_finegrained_prompt_length_s = max_finegrained_prompt_length_s

        if not os.path.exists(log_dir):
            os.makedirs(log_dir)

    async def run(self):
        tasks = [
            asyncio.create_task(self._index_images()),
        ]
        await asyncio.gather(*tasks)
        logger.info("Context indexing thread started.")

    async def _create_caption(self, image: PIL.Image.Image) -> str:
        response = await self.openai_client.chat.completions.create(
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

    async def _index_images(self):
        async def _index_image(item):
            item["image"].save(f"{self.log_dir}/{item['id']}.png")

            if not os.path.exists(f"{self.log_dir}/{item['id']}_caption.txt"):
                caption = await self._create_caption(item["image"])
                with open(f"{self.log_dir}/{item['id']}_caption.txt", "w") as f:
                    f.write(caption)

                logger.info("Created caption")

        logger.info("Starting image indexing thread...")
        while True:
            if self.indexing_queue.empty():
                await asyncio.sleep(0.1)
                continue

            while not self.indexing_queue.empty():
                logger.info("Indexing image...")
                item = await self.indexing_queue.get()
                if item["type"] == "image":
                    self.indexing_tasks.append(asyncio.create_task(_index_image(item)))

    def add_image(self, image: PIL.Image.Image, timestamp: datetime.datetime):
        self.indexing_queue.put_nowait(
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

    def add_text(self, text: str, role: str, timestamp: datetime.datetime):
        self.content.append(
            {
                "type": "text",
                "role": role,
                "text": text,
                "id": self.content_id_counter,
                "timestamp": timestamp.timestamp(),
            }
        )
        self.content_id_counter += 1

    def add_tool_call_request(
        self,
        name: str,
        arguments: dict,
        tool_call_id: str,
        timestamp: datetime.datetime,
    ):
        self.content.append(
            {
                "type": "tool_call_request",
                "role": "assistant",
                "name": name,
                "arguments": arguments,
                "id": self.content_id_counter,
                "tool_call_id": tool_call_id,
                "timestamp": timestamp.timestamp(),
            }
        )
        self.content_id_counter += 1

    def add_tool_call_result(
        self,
        tool_call_id: str,
        response_structured: dict,
        response_formatted: str,
        timestamp: datetime.datetime,
    ):
        self.content.append(
            {
                "type": "tool_call_response",
                "role": "tool",
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

    def _get_caption(self, image_id: str):
        path = f"{self.log_dir}/{image_id}_caption.txt"
        if not os.path.exists(path):
            return None
        with open(path, "r") as f:
            return f.read()

    def _construct_coarse_context(self) -> list[ChatCompletionMessageParam]:
        entries = []
        for image in self.content:
            caption = self._get_caption(image["id"])
            if caption is None:
                continue

            timestamp_formatted = datetime.datetime.fromtimestamp(
                image["timestamp"]
            ).isoformat()

            entries.append(
                f"Timestamp: {timestamp_formatted}; Image containing: {caption}"
            )

        return [{"role": "user", "content": "\n".join(entries)}]

    async def _visual_recall(self, query: str, start_timestamp: str):
        start_time = datetime.datetime.fromisoformat(start_timestamp)
        end_time = start_time + datetime.timedelta(seconds=5)

        prompt = self._construct_finegrained_context(start_time, end_time)
        response = await self.openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that can recall information from images.",
                },
                *prompt,
                {
                    "role": "user",
                    "content": f"Please help me answer the following question: {repr(query)}",
                },
            ],
        )
        assert response.choices[0].message.content is not None
        return response.choices[0].message.content

    async def recall(self, query: str):
        response = await self.openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that can recall information from images.",
                },
                *self._construct_coarse_context(),
                {
                    "role": "user",
                    "content": f"Please perform the best action you can do answer the following query: {repr(query)}",
                },
            ],
            tool_choice="required",
            tools=[
                {
                    "type": "function",
                    "function": {
                        "description": "Visually inspects some of the data in the context to help answer the query.",
                        "name": "visual_recall",
                        "strict": True,
                        "parameters": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "start_timestamp": {
                                    "type": "string",
                                    "description": "The timestamp to inspect more closely. Must be of the format 'YYYY-MM-DDTHH:MM:SS'.",
                                },
                                "query": {"type": "string"},
                            },
                            "required": ["start_timestamp", "query"],
                        },
                    },
                },
                {
                    "type": "function",
                    "function": {
                        "description": "Directly responds to the query.",
                        "name": "direct_response",
                        "strict": True,
                        "parameters": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {"response": {"type": "string"}},
                            "required": ["response"],
                        },
                    },
                },
            ],
        )
        tool_calls = response.choices[0].message.tool_calls
        assert tool_calls is not None and len(tool_calls) == 1

        tool_call = tool_calls[0]
        if tool_call.function.name == "visual_recall":
            arguments = json.loads(tool_call.function.arguments)
            start_timestamp = arguments["start_timestamp"]
            query = arguments["query"]
            result = await self._visual_recall(query, start_timestamp)

            return result

        elif tool_call.function.name == "direct_response":
            arguments = json.loads(tool_call.function.arguments)
            response = arguments["response"]
            return response

        else:
            raise ValueError(
                f"Unknown tool call function name: {tool_call.function.name}"
            )

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
            if item["type"] == "image" and not (
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
