import json

from openai import AsyncOpenAI


def _valid_json(text: str):
    try:
        json.loads(text)
        return True
    except json.JSONDecodeError:
        return False


async def stream_openai_request_and_accumulate_toolcalls(
    openai_client: AsyncOpenAI, messages: list, model="gpt-4o"
):
    aggregated_tool_calls: dict[int, dict] = {}
    completed_tool_calls = set()
    async for chunk in await openai_client.chat.completions.create(
        model=model, messages=messages, stream=True
    ):
        delta = chunk.choices[0].delta

        if delta.tool_calls is not None:
            for tool_call in delta.tool_calls:
                if tool_call.index not in aggregated_tool_calls:
                    aggregated_tool_calls[tool_call.index] = {
                        "function": {"name": "", "arguments": ""}
                    }

                if tool_call.id is not None:
                    aggregated_tool_calls[tool_call.index]["id"] = tool_call.id
                if tool_call.function is not None:
                    if tool_call.function.name is not None:
                        aggregated_tool_calls[tool_call.index]["function"][
                            "name"
                        ] += tool_call.function.name
                    if tool_call.function.arguments is not None:
                        aggregated_tool_calls[tool_call.index]["function"][
                            "arguments"
                        ] += tool_call.function.arguments

        # Check for completed tool calls.
        for aggregated_tool_call in aggregated_tool_calls.values():
            if (
                aggregated_tool_call["id"] is not None
                and aggregated_tool_call["function"]["name"] != ""
                and aggregated_tool_call["function"]["arguments"] != ""
                and _valid_json(aggregated_tool_call["function"]["arguments"])
                and aggregated_tool_call["id"] not in completed_tool_calls
            ):
                completed_tool_calls.add(aggregated_tool_call["id"])

                yield {"type": "tool_call", "tool_call": aggregated_tool_call}

        # Check for content.
        if delta.content is not None:
            yield {"type": "text", "content": delta.content}
