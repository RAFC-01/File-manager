const fs = require('fs').promises;
const path = require('path');

onmessage = async (e) => {
    let startPath = e.data.path;
    console.log(startPath);
    let currentLength = 0;
    let currentStep = 0;
    const results = [];
    console.log(e.data.ignored);
    async function calculateSize(currentPath){
        for (let i = 0; i < e.data.ignored.length; i++){
            if (currentPath.includes(e.data.ignored[i])) {
                return;
            };
        }

        if (currentLength > currentStep) {
            console.log(`Processed ${currentLength} entries…`);
            currentStep += 1000;
        }

        try {
            const stats = await fs.stat(currentPath);
            const relativePath = path.relative(startPath, currentPath) || path.basename(currentPath);

            if (stats.isFile()) {
                // Add file to results
                results.push({
                    path: relativePath,
                    size: stats.size,
                    isFile: true,
                });
                return stats.size;
            } else if (stats.isDirectory()) {
                // Calculate total size of directory
                let dirSize = 0;
                const items = await fs.readdir(currentPath);

                currentLength += items.length;

                for (const item of items) {
                    const itemPath = path.join(currentPath, item);
                    try {
                        dirSize += await calculateSize(itemPath);
                    } catch (err) {
                        // console.warn(`Warning: Cannot access ${itemPath}: ${err.message}`);
                    }
                }

                // Add directory to results
                results.push({
                    path: relativePath,
                    size: dirSize,
                    isFile: false,
                });
                return dirSize;
            }
            return 0; // Ignore symlinks or other non-file/directory types
        } catch (err) {
            // console.log(err)
            return 0;
        }
    }

    // Start traversal
    await calculateSize(startPath);

    postMessage(results);
}