import { Code } from 'lucide-react';
import Editor from '@monaco-editor/react';

interface CodeEditorProps {
    code?: string;
    language?: string;
    onChange?: (code: string) => void;
}

export default function CodeEditor({ code = '', language = 'javascript', onChange }: CodeEditorProps) {
    return (
        <div className="w-full h-[28rem] border rounded-lg bg-gray-900 text-white overflow-hidden">
            <div className="flex items-center gap-2 p-3 border-b border-gray-700 bg-gray-800">
                <Code className="w-4 h-4" />
                <span className="text-sm font-medium">Editor de Código</span>
                <span className="text-xs text-gray-400">({language})</span>
            </div>
            <div className="h-[24rem]">
                <Editor
                    value={code}
                    language={language}
                    theme="vs-dark"
                    onChange={(value) => onChange?.(value ?? '')}
                    options={{
                        minimap: { enabled: false },
                        fontSize: 13,
                        lineNumbers: 'on',
                        automaticLayout: true,
                        scrollBeyondLastLine: false
                    }}
                />
            </div>
        </div>
    );
}
