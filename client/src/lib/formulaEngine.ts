import { SparseGrid, parseCellRef, parseRange } from './sparseGrid';

export class FormulaEngine {
  private grid: SparseGrid;

  constructor(grid: SparseGrid) {
    this.grid = grid;
  }

  setGrid(grid: SparseGrid): void {
    this.grid = grid;
  }

  private getCellValue(ref: string): number {
    const parsed = parseCellRef(ref);
    if (!parsed) return 0;
    const cell = this.grid.getCell(parsed.row, parsed.col);
    const val = parseFloat(cell.value.replace(/[^\d.-]/g, ''));
    return isNaN(val) ? 0 : val;
  }

  private getRangeValues(rangeStr: string): number[] {
    const cells = parseRange(rangeStr);
    return cells.map(c => {
      const cell = this.grid.getCell(c.row, c.col);
      const val = parseFloat(cell.value.replace(/[^\d.-]/g, ''));
      return isNaN(val) ? 0 : val;
    });
  }

  private getRangeNonEmptyValues(rangeStr: string): number[] {
    const cells = parseRange(rangeStr);
    const values: number[] = [];
    for (const c of cells) {
      const cell = this.grid.getCell(c.row, c.col);
      if (cell.value.trim() !== '') {
        const val = parseFloat(cell.value.replace(/[^\d.-]/g, ''));
        if (!isNaN(val)) values.push(val);
      }
    }
    return values;
  }

  evaluate(formula: string): string {
    if (!formula?.startsWith('=')) return formula;
    const expr = formula.substring(1).toUpperCase().trim();

    try {
      if (expr.startsWith('SUM(')) {
        const match = expr.match(/^SUM\(([^)]+)\)$/);
        if (match) {
          const values = this.getRangeValues(match[1]);
          return values.reduce((a, b) => a + b, 0).toString();
        }
      }

      if (expr.startsWith('AVERAGE(')) {
        const match = expr.match(/^AVERAGE\(([^)]+)\)$/);
        if (match) {
          const values = this.getRangeNonEmptyValues(match[1]);
          if (values.length === 0) return '0';
          return (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
        }
      }

      if (expr.startsWith('COUNT(')) {
        const match = expr.match(/^COUNT\(([^)]+)\)$/);
        if (match) {
          return this.getRangeNonEmptyValues(match[1]).length.toString();
        }
      }

      if (expr.startsWith('COUNTA(')) {
        const match = expr.match(/^COUNTA\(([^)]+)\)$/);
        if (match) {
          const cells = parseRange(match[1]);
          let count = 0;
          for (const c of cells) {
            const cell = this.grid.getCell(c.row, c.col);
            if (cell.value.trim() !== '') count++;
          }
          return count.toString();
        }
      }

      if (expr.startsWith('MAX(')) {
        const match = expr.match(/^MAX\(([^)]+)\)$/);
        if (match) {
          const values = this.getRangeNonEmptyValues(match[1]);
          if (values.length === 0) return '0';
          return Math.max(...values).toString();
        }
      }

      if (expr.startsWith('MIN(')) {
        const match = expr.match(/^MIN\(([^)]+)\)$/);
        if (match) {
          const values = this.getRangeNonEmptyValues(match[1]);
          if (values.length === 0) return '0';
          return Math.min(...values).toString();
        }
      }

      if (expr.startsWith('ROUND(')) {
        const match = expr.match(/^ROUND\(([^,]+),?\s*(\d*)\)$/);
        if (match) {
          const value = this.evaluateExpression(match[1]);
          const decimals = parseInt(match[2] || '0', 10);
          return Number(value).toFixed(decimals);
        }
      }

      if (expr.startsWith('ABS(')) {
        const match = expr.match(/^ABS\(([^)]+)\)$/);
        if (match) {
          const value = this.evaluateExpression(match[1]);
          return Math.abs(Number(value)).toString();
        }
      }

      if (expr.startsWith('SQRT(')) {
        const match = expr.match(/^SQRT\(([^)]+)\)$/);
        if (match) {
          const value = this.evaluateExpression(match[1]);
          return Math.sqrt(Number(value)).toString();
        }
      }

      if (expr.startsWith('POWER(')) {
        const match = expr.match(/^POWER\(([^,]+),\s*([^)]+)\)$/);
        if (match) {
          const base = this.evaluateExpression(match[1]);
          const exp = this.evaluateExpression(match[2]);
          return Math.pow(Number(base), Number(exp)).toString();
        }
      }

      if (expr.startsWith('IF(')) {
        return this.evaluateIf(expr);
      }

      if (expr.startsWith('CONCAT(') || expr.startsWith('CONCATENATE(')) {
        const match = expr.match(/^(?:CONCAT|CONCATENATE)\(([^)]+)\)$/);
        if (match) {
          const parts = match[1].split(',').map(p => p.trim());
          const result = parts.map(p => {
            if (p.startsWith('"') && p.endsWith('"')) {
              return p.slice(1, -1);
            }
            const ref = parseCellRef(p);
            if (ref) {
              return this.grid.getCell(ref.row, ref.col).value;
            }
            return p;
          }).join('');
          return result;
        }
      }

      const cellRefMatch = expr.match(/^([A-Z]+\d+)$/);
      if (cellRefMatch) {
        return this.getCellValue(cellRefMatch[1]).toString();
      }

      return this.evaluateExpression(expr).toString();
    } catch (e) {
      return '#ERROR';
    }
  }

  private evaluateIf(expr: string): string {
    const inner = expr.slice(3, -1);
    let depth = 0;
    let commaPositions: number[] = [];
    
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '(') depth++;
      else if (inner[i] === ')') depth--;
      else if (inner[i] === ',' && depth === 0) {
        commaPositions.push(i);
      }
    }
    
    if (commaPositions.length < 2) return '#ERROR';
    
    const condition = inner.slice(0, commaPositions[0]).trim();
    const trueVal = inner.slice(commaPositions[0] + 1, commaPositions[1]).trim();
    const falseVal = inner.slice(commaPositions[1] + 1).trim();
    
    const condResult = this.evaluateCondition(condition);
    return condResult ? this.evaluateExpression(trueVal).toString() : this.evaluateExpression(falseVal).toString();
  }

  private evaluateCondition(condition: string): boolean {
    const operators = ['>=', '<=', '<>', '!=', '=', '>', '<'];
    
    for (const op of operators) {
      const parts = condition.split(op);
      if (parts.length === 2) {
        const left = this.evaluateExpression(parts[0].trim());
        const right = this.evaluateExpression(parts[1].trim());
        
        switch (op) {
          case '>=': return Number(left) >= Number(right);
          case '<=': return Number(left) <= Number(right);
          case '<>':
          case '!=': return left !== right;
          case '=': return left === right || Number(left) === Number(right);
          case '>': return Number(left) > Number(right);
          case '<': return Number(left) < Number(right);
        }
      }
    }
    
    return Boolean(this.evaluateExpression(condition));
  }

  private evaluateExpression(expr: string): string | number {
    const trimmed = expr.trim();
    
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }
    
    const numVal = parseFloat(trimmed);
    if (!isNaN(numVal) && trimmed === numVal.toString()) {
      return numVal;
    }
    
    const cellRef = parseCellRef(trimmed);
    if (cellRef) {
      return this.getCellValue(trimmed);
    }
    
    const resolved = trimmed.replace(/([A-Z]+\d+)/gi, (match) => {
      return this.getCellValue(match).toString();
    });
    
    try {
      const safeExpr = resolved.replace(/[^0-9+\-*/.() ]/g, '');
      if (safeExpr.trim()) {
        return Function(`"use strict"; return (${safeExpr})`)();
      }
    } catch (e) {
    }
    
    return resolved;
  }
}
