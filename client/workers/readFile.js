const fs = require('fs').promises;
const os = require('os');
const path = require('path');
let currentLength = 0;
const files = [];
onmessage = async (e) => {
    let nestedTimes = 0;
    const checkDir = async (currentDir) => {
        if (currentDir.includes('C:\\Windows')) {
            return
        };
    
        nestedTimes++;


        
        let entries;
        try {
            entries = await fs.readdir(currentDir, { withFileTypes: true });
        } catch (err) {
            // probably permission denied or some other I/O error—just skip
            return;
        }
    
        currentLength += entries.length;
        if (currentLength % 100 === 0) {
            // console.log(`Processed ${currentLength} entries…`);
        }
        
        // if (currentDir == 'C:\\Users\\Admin') {
        //     let len = await fs.readdir(currentDir, { withFileTypes: true });
        //     postMessage({path: currentDir, len: len})
        //     return;
        // }

        for (const entry of entries) {
            const subdir = path.join(currentDir, entry.name);
            files.push(entry);
            if (entry.isDirectory()) {
                await checkDir(subdir);
            }
        }
    }
    await checkDir(e.data);
    console.log(e.data);
    postMessage(files);
}