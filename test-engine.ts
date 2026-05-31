import { CoreEngine } from './packages/core-engine/src/index';

async function run() {
    const engine = new CoreEngine();

    console.log('=== Mock Project Analysis ===\n');
    const diags = await engine.analyze(__dirname + '/scratch/mock-project', {
        includePatterns: ['**/*.{ts,tsx,js,jsx}'],
        ignorePatterns: []
    });

    if (diags.length === 0) {
        console.log('No dead code found.');
    } else {
        for (const d of diags) {
            const shortPath = d.filePath.replace(__dirname + '/scratch/mock-project/src/', '');
            console.log(`  [${d.severity}] ${shortPath}: ${d.message}`);
        }
    }

    console.log(`\nTotal issues: ${diags.length}`);
}

run().catch(console.error);
