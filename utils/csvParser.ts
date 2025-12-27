import { Trade } from '../types';

// Helper for splitting CSV rows respecting quotes
const parseCSVRow = (row: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
};

export const parseTradingViewCSV = (csvContent: string): Trade[] => {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) return [];

  // Remove BOM if present
  if (lines[0].charCodeAt(0) === 0xFEFF) {
    lines[0] = lines[0].slice(1);
  }

  // Find headers
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  
  // Mapping column names to indices
  const colMap: Record<string, number> = {};
  headers.forEach((h, i) => {
    colMap[h] = i;
  });

  // Detect Format Strategy
  if (colMap['net_pnl'] !== undefined) {
     return parseCustomSnakeCase(lines, colMap);
  } else if (colMap['Net P&L USD'] !== undefined || colMap['Profit USD'] !== undefined) {
     return parseStandardTradingView(lines, colMap);
  } else {
     // Try to be lenient and look for just PnL column
     const pnlCol = Object.keys(colMap).find(k => k.toLowerCase().includes('p&l') || k.toLowerCase().includes('profit'));
     if (pnlCol) {
         return parseStandardTradingView(lines, colMap); // Attempt standard
     }
     
     console.error("Unknown CSV format. Headers found:", headers);
     throw new Error(`Invalid CSV format. Could not detect PnL column (e.g. 'net_pnl' or 'Net P&L USD').`);
  }
};

const parseCustomSnakeCase = (lines: string[], colMap: Record<string, number>): Trade[] => {
    const trades: Trade[] = [];
    
    for (let i = 1; i < lines.length; i++) {
        const row = parseCSVRow(lines[i]);
        if (row.length < Object.keys(colMap).length * 0.5) continue; // Skip malformed lines

        const pnlRaw = row[colMap['net_pnl']];
        const sideRaw = row[colMap['side']] || 'Long';
        const entryTime = row[colMap['entry_time']] || '';
        const exitTime = row[colMap['exit_time']] || entryTime;
        
        // Price data
        const entryPriceRaw = row[colMap['entry_price']];
        const exitPriceRaw = row[colMap['exit_price']];

        if (!pnlRaw) continue;

        const pnl = parseFloat(pnlRaw.replace(/[$,]/g, ''));
        if (isNaN(pnl)) continue;

        // Type normalization
        let type: 'Long' | 'Short' = 'Long';
        const lowerSide = sideRaw.toLowerCase();
        if (lowerSide.includes('short') || lowerSide.includes('sell')) {
            type = 'Short';
        }

        const entryPrice = parseFloat(entryPriceRaw);
        const exitPrice = parseFloat(exitPriceRaw);

        // Calculate % if available
        let pnlPercent = 0;
        
        if (!isNaN(entryPrice) && !isNaN(exitPrice) && entryPrice !== 0) {
            if (type === 'Long') {
                pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
            } else {
                pnlPercent = ((entryPrice - exitPrice) / entryPrice) * 100;
            }
        }

        trades.push({
            id: (i).toString(),
            entryTime,
            exitTime,
            type,
            pnl,
            pnlPercent,
            entryPrice: isNaN(entryPrice) ? undefined : entryPrice,
            exitPrice: isNaN(exitPrice) ? undefined : exitPrice
        });
    }

    return trades;
};

const parseStandardTradingView = (lines: string[], colMap: Record<string, number>): Trade[] => {
    const uniqueTrades = new Map<string, Trade>();
    
    // Identify key columns
    const idCol = colMap['Trade #'];
    const typeCol = colMap['Type'];
    const pnlCol = colMap['Net P&L USD'] !== undefined ? colMap['Net P&L USD'] : colMap['Profit USD'];
    const pnlPercentCol = colMap['Net P&L %'] !== undefined ? colMap['Net P&L %'] : colMap['Profit %'];
    
    // Date/Time variants
    const entryDateCol = colMap['Date/Time'] ?? colMap['Date and time'] ?? colMap['Entry Date/Time'];
    const exitDateCol = colMap['Exit Date/Time'];

    // Price variants
    const entryPriceCol = colMap['Price'] ?? colMap['Entry Price'];
    const exitPriceCol = colMap['Exit Price'];

    if (pnlCol === undefined) return [];

    for (let i = 1; i < lines.length; i++) {
        const row = parseCSVRow(lines[i]);
        if (row.length < 2) continue;

        const tradeId = idCol !== undefined ? row[idCol] : i.toString();
        const pnlRaw = row[pnlCol];
        
        if (!pnlRaw) continue;

        if (!uniqueTrades.has(tradeId)) {
            const pnl = parseFloat(pnlRaw.replace(/[$,]/g, ''));
            
            // Percentage
            let pnlPercent = 0;
            if (pnlPercentCol !== undefined && row[pnlPercentCol]) {
                pnlPercent = parseFloat(row[pnlPercentCol].replace(/[%]/g, ''));
            }

            // Dates
            const entryTime = entryDateCol !== undefined ? row[entryDateCol] : '';
            const exitTime = exitDateCol !== undefined ? row[exitDateCol] : entryTime;

            // Type
            let type: 'Long' | 'Short' = 'Long';
            if (typeCol !== undefined) {
                const rawType = row[typeCol].toLowerCase();
                if (rawType.includes('short') || rawType.includes('sell')) {
                    type = 'Short';
                }
            }

            // Prices
            let entryPrice: number | undefined;
            let exitPrice: number | undefined;

            if (entryPriceCol !== undefined && row[entryPriceCol]) {
                const val = parseFloat(row[entryPriceCol].replace(/[$,]/g, ''));
                if (!isNaN(val)) entryPrice = val;
            }
            if (exitPriceCol !== undefined && row[exitPriceCol]) {
                const val = parseFloat(row[exitPriceCol].replace(/[$,]/g, ''));
                if (!isNaN(val)) exitPrice = val;
            }

            if (isNaN(pnl)) continue;

            uniqueTrades.set(tradeId, {
                id: tradeId,
                entryTime,
                exitTime,
                type,
                pnl,
                pnlPercent: isNaN(pnlPercent) ? 0 : pnlPercent,
                entryPrice,
                exitPrice
            });
        }
    }

    return Array.from(uniqueTrades.values()).sort((a, b) => {
        // Try numerical sort if IDs are numbers
        const idA = parseInt(a.id);
        const idB = parseInt(b.id);
        if (!isNaN(idA) && !isNaN(idB)) return idA - idB;
        return 0;
    });
};