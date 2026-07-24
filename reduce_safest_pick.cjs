const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'pages', 'MatchDetails.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Reduce Safest Pick padding and min height
content = content.replace(
    'className="relative z-10 p-6 flex flex-col md:flex-row items-center justify-between text-center md:text-left min-h-[160px]"',
    'className="relative z-10 p-4 md:p-5 flex flex-col md:flex-row items-center justify-between text-center md:text-left"'
);

// Reduce Trophy icon container size
content = content.replace(
    'className="w-24 h-24 md:w-32 md:h-32 rounded-full mb-4 md:mb-0 md:mr-6 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.3)] bg-vantage-bg/50 border border-emerald-500/20 shrink-0"',
    'className="w-16 h-16 md:w-20 md:h-20 rounded-full mb-3 md:mb-0 md:mr-5 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)] bg-vantage-bg/50 border border-emerald-500/20 shrink-0"'
);

// Reduce Trophy icon size
content = content.replace(
    '<Trophy size={48} className="text-emerald-400" />',
    '<Trophy size={32} className="text-emerald-400" />'
);

// Reduce Prediction Name text size
content = content.replace(
    'className="text-xl md:text-2xl font-bold text-white mb-2"',
    'className="text-lg md:text-xl font-bold text-white mb-1"'
);

// Reduce Confidence text size
content = content.replace(
    'className="text-4xl md:text-5xl font-black font-mono text-emerald-400 drop-shadow-[0_0_15px_rgba(16,185,129,0.5)]"',
    'className="text-3xl md:text-4xl font-black font-mono text-emerald-400 drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]"'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log("Reduced Safest Pick section size.");
