/// <reference lib="webworker" />

declare var AudioWorkletProcessor: {
    prototype: AudioWorkletProcessor;
    new (): AudioWorkletProcessor;
};

declare interface AudioWorkletProcessor {
    readonly port: MessagePort;
    process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>
    ): boolean;
}

interface AudioParamDescriptor {
    name: string;
    automationRate?: "a-rate" | "k-rate";
    minValue?: number;
    maxValue?: number;
    defaultValue?: number;
}

declare function registerProcessor(
    name: string,
    processorCtor: (new () => AudioWorkletProcessor) & {
        parameterDescriptors?: AudioParamDescriptor[];
    }
): void;

class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.port.onmessage = this.handleMessage.bind(this);
    }

    handleMessage(event: MessageEvent) {
        // Handle any messages from the main thread if needed
    }

    process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>
    ): boolean {
        const input = inputs[0]; // Get the first input
        if (!input || !input[0]) return true;

        const inputChannel = input[0]; // Get the first channel of input

        // Convert Float32Array to Int16Array (PCM 16-bit)
        const pcmData = new Int16Array(inputChannel.length);
        for (let i = 0; i < inputChannel.length; i++) {
            // Convert float32 to int16
            const s = Math.max(-1, Math.min(1, inputChannel[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Send the PCM data to the main thread
        this.port.postMessage(
            {
                type: "pcm-data",
                data: pcmData.buffer,
            },
            [pcmData.buffer]
        ); // Transfer the buffer to avoid copying

        return true;
    }
}

registerProcessor("pcm-processor", PCMProcessor);
