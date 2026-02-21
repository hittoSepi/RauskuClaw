#!/usr/bin/env python3
"""Auto git add for edited files"""
import json
import subprocess
import sys

def main():
    try:
        # Read input from stdin
        input_data = json.load(sys.stdin)

        # Get tool name and file path
        tool_name = input_data.get('tool_name', '')
        tool_input = input_data.get('tool_input', {})

        # Only process Edit/Write/MultiEdit tools
        if tool_name not in ['Edit', 'Write', 'MultiEdit']:
            sys.exit(0)

        # Get file path from tool_input
        file_path = tool_input.get('file_path')

        # For MultiEdit, file_path might be in a different location
        if not file_path and tool_name == 'MultiEdit':
            # MultiEdit structure may vary
            file_path = tool_input.get('file_path') or tool_input.get('path')

        if not file_path:
            sys.exit(0)

        # Run git add
        subprocess.run(
            ['git', 'add', file_path],
            capture_output=True,
            timeout=5
        )

    except Exception:
        # Silent fail - don't break the workflow
        pass
    finally:
        sys.exit(0)

if __name__ == '__main__':
    main()
