const os = require('os');
const fs = require('fs').promises;
const path = require('path');

let number = 0;

document.addEventListener('mousedown', () => {
    number++;
    document.querySelector('body').innerHTML = number;
});

/**
 * @typedef file
 * @property {string} name 
 * @property {string} parentPath 
 * @property {string} path 
 */
/**
 * @type {file[]}
 */
let files = [];

const APPDATA = getAppData();
const APPNAME = 'FileManager'

const savePath = path.join(APPDATA, APPNAME);

if (!dirExists(savePath)){
  fs.mkdir(savePath);
}


async function tryToLoadFiles(){
  try {
    let data = await fs.readFile(path.join(savePath, 'saved_data.json'));
    files = JSON.parse(data);
  } catch (error) {
    console.error(error)
  }
}
function clamp(val, min, max){
  return Math.max(min, Math.min(val, max));
}
/**
 * 
 * @param {string} search 
 * @returns 
 */
function searchFiles(search = ""){
  console.time('search');
  let list = [];
  let mode = 0;
  if (search == '*') return files;
  if (search.substring(0, 2) == '*.' || search[0] == '.') mode = 1;
  for (let i = 0; i < files.length; i++){
    let f = files[i];
    if (mode == 0){
      let score = 0;
      if (f.name.includes(search)) score += 1;
      let lengthDiff = Math.abs(search.length - f.name.length);
      score += 1 - clamp(lengthDiff / 100, 0, 1);
      if (score > 1){
        list.push({file: f, score: score});
      }
    }
    if (mode == 1){
      let end = search.substring(search.indexOf('.'), search.length);
      if (f.name.endsWith(end)){
        list.push({file: f, score: 0});
      }
    }
    // if (list.length > 100) break;
  }
  console.timeEnd('search');
  return list.sort((a, b) => b.score - a.score);
}

async function dirExists(path) {
  try {
    const stats = await fs.stat(path);
    return stats.isDirectory();
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}
function getAppData(){
  let appData;

  switch (os.platform()) {
    case 'win32':
      appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      break;
    case 'darwin':
      appData = path.join(os.homedir(), 'Library', 'Application Support');
      break;
    case 'linux':
      appData = path.join(os.homedir(), '.config');
      break;
    default:
      throw new Error('Unsupported OS');
  }
  return appData;
}

async function findAllFiles(dir) {
  console.time('find files');
  let currentLength = 0;
  const concurrency = 10; 
  const active = new Set(); // track currently running tasks

  // limiter(fn) will:
  //  - if active.size < concurrency, immediately start fn()
  //  - otherwise wait until any active task finishes (Promise.race), then start fn()
  // It returns the Promise that represents fn().

  async function checkDir(currentDir) {
    if (currentDir.includes('C:\\Windows')) {
        return
    };

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      // probably permission denied or some other I/O error—just skip
      return;
    }

    currentLength += entries.length;
    if (currentLength % 100 === 0) {
      console.log(`Processed ${currentLength} entries…`);
    }


    for (const entry of entries) {
        files.push(entry);
        if (entry.isDirectory()) {
            const subdir = path.join(currentDir, entry.name);
            // schedule checkDir(subdir) under our concurrency limiter
            await checkDir(subdir);
        }
    }
  }

  await checkDir(dir)


  console.timeEnd('find files');
  console.log(`Total entries visited: ${currentLength}`);

  fs.writeFile(path.join(savePath, 'saved_data.json'), JSON.stringify(files));
}

// findAllFiles('C:/').catch(console.error);
tryToLoadFiles();