
import * as fs from 'fs';
import * as path from 'path';
import { generateWordFromMarkdown } from '../server/services/markdownToDocx';

async function testDocxGeneration() {
    console.log('--- Starting Docx Generation Test ---');

    const title = "Test Document";
    const markdownContent = `
# Introduction

This is a **bold** statement. This is *italic*.

## Valid Section

Here is a list:
- Item 1
- Item 2
- Item 3

### Subsection

> This is a quote.

Some code:
\`\`\`
console.log('hello world');
\`\`\`

End of document.
    `.trim();

    console.log(`Input Markdown Length: ${markdownContent.length}`);
    console.log('--- Content Preview ---');
    console.log(markdownContent);
    console.log('-----------------------');

    try {
        const buffer = await generateWordFromMarkdown(title, markdownContent);

        const outputPath = path.join(process.cwd(), 'test_output.docx');
        fs.writeFileSync(outputPath, buffer);

        const stats = fs.statSync(outputPath);
        console.log(`Success! File written to: ${outputPath}`);
        console.log(`File Size: ${stats.size} bytes`);

        if (stats.size < 10000) {
            console.error('WARNING: File size is suspiciously small (under 10KB). Content might be missing.');
        } else {
            console.log('File size looks reasonable for a populated document.');
        }

    } catch (error) {
        console.error('Error generating docx:', error);
    }
}

testDocxGeneration();
