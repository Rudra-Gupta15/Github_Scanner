import { useState } from 'react';
import { 
  Folder, FolderOpen, FileCode2, FileJson, FileText, 
  Settings, Globe, ShieldAlert, File, ChevronRight 
} from 'lucide-react';
import './FileTree.css';

function getFileIcon(name) {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('ignore')) return <ShieldAlert size={14} color="#EF4444" className="tree-icon" />;
  if (lowerName === 'license') return <FileText size={14} color="#9CA3AF" className="tree-icon" />;

  const ext = lowerName.split('.').pop();
  switch (ext) {
    case 'py':
      return <FileCode2 size={14} color="#3B82F6" className="tree-icon" />;
    case 'js':
    case 'jsx':
      return <FileCode2 size={14} color="#FBBF24" className="tree-icon" />;
    case 'ts':
    case 'tsx':
    case 'css':
      return <FileCode2 size={14} color="#60A5FA" className="tree-icon" />;
    case 'json':
      return <FileJson size={14} color="#10B981" className="tree-icon" />;
    case 'md':
    case 'txt':
      return <FileText size={14} color="#9CA3AF" className="tree-icon" />;
    case 'html':
      return <Globe size={14} color="#F97316" className="tree-icon" />;
    case 'yml':
    case 'yaml':
    case 'env':
    case 'example':
      return <Settings size={14} color="#8B5CF6" className="tree-icon" />;
    default:
      return <File size={14} color="#9CA3AF" className="tree-icon" />;
  }
}

function TreeNode({ node, onFileSelect, selectedPath, depth = 0 }) {
  const [open, setOpen] = useState(depth < 1);

  if (node.type === 'dir') {
    return (
      <div className="tree-dir">
        <button
          className="tree-row tree-dir-row"
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => setOpen(!open)}
        >
          <span className={`tree-chevron ${open ? 'tree-chevron-open' : ''}`}>
            <ChevronRight size={14} />
          </span>
          {open ? (
            <FolderOpen size={14} color="#FBBF24" className="tree-icon" fill="currentColor" fillOpacity={0.2} />
          ) : (
            <Folder size={14} color="#FBBF24" className="tree-icon" fill="currentColor" fillOpacity={0.2} />
          )}
          <span className="tree-name">{node.name}</span>
        </button>
        {open && node.children && (
          <div className="tree-children">
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                onFileSelect={onFileSelect}
                selectedPath={selectedPath}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = selectedPath === node.path;
  return (
    <button
      className={`tree-row tree-file-row ${isSelected ? 'tree-file-selected' : ''}`}
      style={{ paddingLeft: `${12 + depth * 16}px` }}
      onClick={() => onFileSelect(node.path)}
    >
      {getFileIcon(node.name)}
      <span className="tree-name">{node.name}</span>
    </button>
  );
}

export default function FileTree({ tree, onFileSelect, selectedPath }) {
  if (!tree || tree.length === 0) {
    return <div className="tree-empty">No files found</div>;
  }

  return (
    <div className="file-tree">
      <div className="tree-header">
        <Folder size={14} color="#FBBF24" className="tree-header-icon" />
        <span>Explorer</span>
      </div>
      <div className="tree-scroll">
        {tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            onFileSelect={onFileSelect}
            selectedPath={selectedPath}
          />
        ))}
      </div>
    </div>
  );
}
