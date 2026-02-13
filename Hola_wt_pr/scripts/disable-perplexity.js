// Script to disable Perplexity models (no API key configured)
// Run with: node scripts/disable-perplexity.js

const { storage } = require('../server/storage');

const PERPLEXITY_MODEL_IDS = [
  '092c4d6d-b6a0-4097-96b1-a413cebbf769', // Sonar Reasoning
  '69a77f0c-c114-4385-b79a-4e08a0515707', // Sonar Reasoning Pro
  '1ed2e982-9f97-4d8a-afd2-14768f798613', // Sonar
  '87bc21cb-d305-4405-9032-62f6ddc57c48', // Sonar Pro
];

async function disablePerplexityModels() {
  console.log('Disabling Perplexity models (no API key configured)...');
  
  for (const id of PERPLEXITY_MODEL_IDS) {
    try {
      const result = await storage.updateAiModel(id, {
        isEnabled: 'false',
        enabledAt: null,
        enabledByAdminId: null,
      });
      console.log(`Disabled: ${result?.name || id}`);
    } catch (error) {
      console.error(`Error disabling ${id}:`, error.message);
    }
  }
  
  console.log('Done!');
  process.exit(0);
}

disablePerplexityModels();
