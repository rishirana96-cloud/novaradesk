import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
let backend=readFileSync('reference/worker.js','utf8').replace('export default {','const legacyBackend = {');
backend=backend.replace("      const selectedProvider = String(provider || 'deepseek').toLowerCase();",`      if (env.WHATSAPP_TEST_MODE === 'receipt') return {text:'NovaraDesk staging: Your message was received successfully. This is an integration test.', provider:'integration-test', model:'none'};
      const selectedProvider = String(provider || 'deepseek').toLowerCase();`);
const connector=readFileSync('src/connector.js','utf8').replaceAll('export ','');
mkdirSync('dist',{recursive:true});
writeFileSync('dist/worker.js',backend+'\n'+connector+'\nexport default createHandler(legacyBackend);\n');
