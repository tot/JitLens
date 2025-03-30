import openai
from context import Context
from streaming import Streaming


openai_client = openai.AsyncOpenAI()

context = Context("./context", openai_client)
streaming = Streaming(context, openai_client)
