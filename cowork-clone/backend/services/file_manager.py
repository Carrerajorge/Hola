"""
File Management Service - Core engine for file operations.
Handles reading, writing, creating, deleting, organizing files within a workspace.
"""
import os
import shutil
import json
import asyncio
import aiofiles
import mimetypes
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from datetime import datetime
from collections import defaultdict

from backend.models.schemas import FileInfo, WorkspaceInfo


class FileManager:
    """Manages all file operations within a sandboxed workspace."""

    def __init__(self, workspace_path: str):
        self.workspace_path = os.path.abspath(workspace_path)
        self._ensure_workspace_exists()

    def _ensure_workspace_exists(self):
        os.makedirs(self.workspace_path, exist_ok=True)

    def _validate_path(self, path: str) -> str:
        """Ensure path is within workspace (security sandbox)."""
        full_path = os.path.abspath(os.path.join(self.workspace_path, path))
        if not full_path.startswith(self.workspace_path):
            raise PermissionError(f"Access denied: path is outside workspace")
        return full_path

    def _get_file_info(self, path: str) -> FileInfo:
        """Get detailed information about a file or directory."""
        stat = os.stat(path)
        rel_path = os.path.relpath(path, self.workspace_path)
        name = os.path.basename(path)
        is_dir = os.path.isdir(path)
        ext = os.path.splitext(name)[1] if not is_dir else None
        mime = mimetypes.guess_type(path)[0] if not is_dir else None

        return FileInfo(
            name=name,
            path=rel_path,
            size=stat.st_size,
            is_dir=is_dir,
            extension=ext,
            modified_at=datetime.fromtimestamp(stat.st_mtime),
            mime_type=mime
        )

    # ─── List Operations ─────────────────────────────────
    async def list_directory(self, path: str = ".") -> List[FileInfo]:
        """List contents of a directory."""
        full_path = self._validate_path(path)
        if not os.path.isdir(full_path):
            raise FileNotFoundError(f"Directory not found: {path}")

        items = []
        for entry in sorted(os.listdir(full_path)):
            entry_path = os.path.join(full_path, entry)
            if not entry.startswith('.'):  # Skip hidden files by default
                try:
                    items.append(self._get_file_info(entry_path))
                except (PermissionError, OSError):
                    continue
        return items

    async def list_recursive(self, path: str = ".", max_depth: int = 5) -> List[FileInfo]:
        """Recursively list all files in directory."""
        full_path = self._validate_path(path)
        items = []

        def _walk(current_path: str, depth: int):
            if depth > max_depth:
                return
            try:
                for entry in sorted(os.listdir(current_path)):
                    if entry.startswith('.'):
                        continue
                    entry_path = os.path.join(current_path, entry)
                    try:
                        items.append(self._get_file_info(entry_path))
                        if os.path.isdir(entry_path):
                            _walk(entry_path, depth + 1)
                    except (PermissionError, OSError):
                        continue
            except PermissionError:
                pass

        _walk(full_path, 0)
        return items

    # ─── Read Operations ─────────────────────────────────
    async def read_file(self, path: str) -> str:
        """Read file contents."""
        full_path = self._validate_path(path)
        if not os.path.isfile(full_path):
            raise FileNotFoundError(f"File not found: {path}")

        async with aiofiles.open(full_path, 'r', errors='replace') as f:
            return await f.read()

    async def read_file_lines(self, path: str, start: int = 0, count: int = 100) -> Tuple[List[str], int]:
        """Read specific lines from a file."""
        full_path = self._validate_path(path)
        async with aiofiles.open(full_path, 'r', errors='replace') as f:
            lines = await f.readlines()
        total = len(lines)
        return lines[start:start + count], total

    # ─── Write Operations ────────────────────────────────
    async def write_file(self, path: str, content: str) -> FileInfo:
        """Write content to a file (creates or overwrites)."""
        full_path = self._validate_path(path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        async with aiofiles.open(full_path, 'w') as f:
            await f.write(content)
        return self._get_file_info(full_path)

    async def append_file(self, path: str, content: str) -> FileInfo:
        """Append content to a file."""
        full_path = self._validate_path(path)
        async with aiofiles.open(full_path, 'a') as f:
            await f.write(content)
        return self._get_file_info(full_path)

    async def create_directory(self, path: str) -> FileInfo:
        """Create a directory."""
        full_path = self._validate_path(path)
        os.makedirs(full_path, exist_ok=True)
        return self._get_file_info(full_path)

    # ─── Modify Operations ───────────────────────────────
    async def rename(self, old_path: str, new_name: str) -> FileInfo:
        """Rename a file or directory."""
        old_full = self._validate_path(old_path)
        new_full = os.path.join(os.path.dirname(old_full), new_name)
        self._validate_path(os.path.relpath(new_full, self.workspace_path))
        os.rename(old_full, new_full)
        return self._get_file_info(new_full)

    async def move(self, src_path: str, dst_path: str) -> FileInfo:
        """Move a file or directory."""
        src_full = self._validate_path(src_path)
        dst_full = self._validate_path(dst_path)
        os.makedirs(os.path.dirname(dst_full), exist_ok=True)
        shutil.move(src_full, dst_full)
        return self._get_file_info(dst_full)

    async def copy(self, src_path: str, dst_path: str) -> FileInfo:
        """Copy a file or directory."""
        src_full = self._validate_path(src_path)
        dst_full = self._validate_path(dst_path)
        os.makedirs(os.path.dirname(dst_full), exist_ok=True)
        if os.path.isdir(src_full):
            shutil.copytree(src_full, dst_full)
        else:
            shutil.copy2(src_full, dst_full)
        return self._get_file_info(dst_full)

    async def delete(self, path: str) -> bool:
        """Delete a file or directory."""
        full_path = self._validate_path(path)
        if os.path.isdir(full_path):
            shutil.rmtree(full_path)
        elif os.path.isfile(full_path):
            os.remove(full_path)
        else:
            raise FileNotFoundError(f"Not found: {path}")
        return True

    # ─── Search Operations ───────────────────────────────
    async def search_files(self, pattern: str, path: str = ".") -> List[FileInfo]:
        """Search for files matching a pattern."""
        full_path = self._validate_path(path)
        results = []
        pattern_lower = pattern.lower()

        for root, dirs, files in os.walk(full_path):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                if pattern_lower in f.lower():
                    fp = os.path.join(root, f)
                    try:
                        results.append(self._get_file_info(fp))
                    except (PermissionError, OSError):
                        continue
        return results

    async def search_content(self, query: str, path: str = ".", extensions: List[str] = None) -> List[Dict]:
        """Search file contents for a query string."""
        full_path = self._validate_path(path)
        results = []
        query_lower = query.lower()
        text_extensions = extensions or ['.txt', '.md', '.py', '.js', '.html', '.css', '.json', '.csv', '.xml', '.yml', '.yaml', '.log']

        for root, dirs, files in os.walk(full_path):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext not in text_extensions:
                    continue
                fp = os.path.join(root, f)
                try:
                    async with aiofiles.open(fp, 'r', errors='replace') as file:
                        content = await file.read()
                    lines = content.split('\n')
                    matches = []
                    for i, line in enumerate(lines):
                        if query_lower in line.lower():
                            matches.append({"line": i + 1, "text": line.strip()})
                    if matches:
                        results.append({
                            "file": os.path.relpath(fp, self.workspace_path),
                            "matches": matches[:10]  # Limit matches per file
                        })
                except (PermissionError, OSError, UnicodeDecodeError):
                    continue
        return results

    # ─── Organization Operations ─────────────────────────
    async def organize_by_extension(self, path: str = ".") -> Dict[str, List[str]]:
        """Organize files into folders by extension."""
        full_path = self._validate_path(path)
        moved = defaultdict(list)

        extension_folders = {
            '.pdf': 'Documents/PDF',
            '.doc': 'Documents/Word', '.docx': 'Documents/Word',
            '.xls': 'Documents/Excel', '.xlsx': 'Documents/Excel',
            '.ppt': 'Documents/PowerPoint', '.pptx': 'Documents/PowerPoint',
            '.txt': 'Documents/Text', '.md': 'Documents/Text',
            '.jpg': 'Images', '.jpeg': 'Images', '.png': 'Images',
            '.gif': 'Images', '.svg': 'Images', '.webp': 'Images',
            '.mp4': 'Videos', '.avi': 'Videos', '.mov': 'Videos', '.mkv': 'Videos',
            '.mp3': 'Audio', '.wav': 'Audio', '.flac': 'Audio', '.aac': 'Audio',
            '.zip': 'Archives', '.rar': 'Archives', '.tar': 'Archives', '.gz': 'Archives',
            '.py': 'Code/Python', '.js': 'Code/JavaScript', '.ts': 'Code/TypeScript',
            '.html': 'Code/Web', '.css': 'Code/Web',
            '.json': 'Data', '.csv': 'Data', '.xml': 'Data',
        }

        for entry in os.listdir(full_path):
            entry_path = os.path.join(full_path, entry)
            if os.path.isfile(entry_path) and not entry.startswith('.'):
                ext = os.path.splitext(entry)[1].lower()
                folder = extension_folders.get(ext, 'Other')
                dest_dir = os.path.join(full_path, folder)
                os.makedirs(dest_dir, exist_ok=True)
                dest_path = os.path.join(dest_dir, entry)
                if not os.path.exists(dest_path):
                    shutil.move(entry_path, dest_path)
                    moved[folder].append(entry)

        return dict(moved)

    async def organize_by_date(self, path: str = ".") -> Dict[str, List[str]]:
        """Organize files into folders by modification date."""
        full_path = self._validate_path(path)
        moved = defaultdict(list)

        for entry in os.listdir(full_path):
            entry_path = os.path.join(full_path, entry)
            if os.path.isfile(entry_path) and not entry.startswith('.'):
                mtime = datetime.fromtimestamp(os.path.getmtime(entry_path))
                folder = mtime.strftime("%Y/%Y-%m")
                dest_dir = os.path.join(full_path, folder)
                os.makedirs(dest_dir, exist_ok=True)
                dest_path = os.path.join(dest_dir, entry)
                if not os.path.exists(dest_path):
                    shutil.move(entry_path, dest_path)
                    moved[folder].append(entry)

        return dict(moved)

    # ─── Workspace Info ──────────────────────────────────
    async def get_workspace_info(self) -> WorkspaceInfo:
        """Get overview of the workspace."""
        total_files = 0
        total_dirs = 0
        total_size = 0
        file_types = defaultdict(int)

        for root, dirs, files in os.walk(self.workspace_path):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            total_dirs += len(dirs)
            for f in files:
                if f.startswith('.'):
                    continue
                total_files += 1
                fp = os.path.join(root, f)
                try:
                    total_size += os.path.getsize(fp)
                    ext = os.path.splitext(f)[1].lower() or 'no extension'
                    file_types[ext] += 1
                except OSError:
                    pass

        return WorkspaceInfo(
            path=self.workspace_path,
            total_files=total_files,
            total_dirs=total_dirs,
            total_size=total_size,
            file_types=dict(file_types)
        )
