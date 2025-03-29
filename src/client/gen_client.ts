import {
    GoogleGenerativeAI,
    GenerativeModel,
    Part,
  } from "@google/generative-ai";
  import * as fs from "fs";
  import "dotenv/config";
  
  const genAI = new GoogleGenerativeAI(process.env.API_KEY);
  
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  
  async function analyzeImage(
    question: string,
    imagePath: string
  ): Promise<void> {
    try {
      const model: GenerativeModel = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
      });
  
      const image: Part = {
        inlineData: {
          data: Buffer.from(fs.readFileSync(imagePath)).toString("base64"),
          mimeType: "image/png",
        },
      };
  
      const result = await model.generateContent([question, image]);
      console.log("Response:", result.response.text());
    } catch (error) {
      console.error("Error:", error);
    }
  }
  
  const question: string | undefined = process.argv[2];
  const imagePath: string | undefined = process.argv[3];
  
  if (!question || !imagePath) {
    console.error("Usage: bun run analyzeImage.ts '<question>' <image-path>");
    process.exit(1);
  }
  
  analyzeImage(question, imagePath);
  