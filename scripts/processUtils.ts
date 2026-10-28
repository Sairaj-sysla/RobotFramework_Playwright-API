/**
 * Locates the Python interpreter that runs Robot Framework.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Python that runs Robot Framework: ROBOT_PYTHON, else the project's .venv, else python on PATH. */
export function robotPython(root: string): string {
  if (process.env.ROBOT_PYTHON) return process.env.ROBOT_PYTHON;
  const venvPython = process.platform === 'win32'
    ? path.join(root, '.venv', 'Scripts', 'python.exe')
    : path.join(root, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) return venvPython;
  return process.platform === 'win32' ? 'python' : 'python3';
}
