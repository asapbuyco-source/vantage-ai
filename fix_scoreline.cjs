const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'pages', 'MatchDetails.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Insert useState
if (!content.includes('selectedScoreline')) {
    content = content.replace(
        'const [isLoadingDetails, setIsLoadingDetails] = useState(false);',
        'const [isLoadingDetails, setIsLoadingDetails] = useState(false);\n    const [selectedScoreline, setSelectedScoreline] = useState<number>(0);'
    );
}

// Update the scoreline block
content = content.replace(
    /className=\{\`flex-1 min-w-\[70px\] flex flex-col items-center justify-center p-2 rounded-lg border \$\{i === 0 \? 'bg-emerald-900\/10 border-emerald-500\/30' \: 'bg-slate-900\/60 border-white\/5'\} transition-colors\`\}>/g,
    'onClick={() => setSelectedScoreline(i)} className={`cursor-pointer hover:bg-white/10 active:scale-95 flex-1 min-w-[70px] flex flex-col items-center justify-center p-2 rounded-lg border ${selectedScoreline === i ? \'bg-emerald-900/10 border-emerald-500/30\' : \'bg-slate-900/60 border-white/5\'} transition-colors`}>'
);

content = content.replace(
    /className=\{\`text-\[10px\] font-mono \$\{i === 0 \? 'text-emerald-400' \: 'text-gray-400'\}\`\}/g,
    'className={`text-[10px] font-mono ${selectedScoreline === i ? \'text-emerald-400\' : \'text-gray-400\'}`}'
);


fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed scorelines to be clickable.');
