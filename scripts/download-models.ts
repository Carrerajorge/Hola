// scripts/download-models.ts
import https from 'https';
import fs from 'fs';

const MODELS = [
    { name: 'groundingdino.onnx', url: 'https://huggingface.co/...' }
];

async function download() {
    for (const model of MODELS) {
        console.log(`Downloading ${model.name}...`);
        // Streaming download implementation
    }
}
download();
