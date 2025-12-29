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
  } else if (colMap['EnteredAt'] !== undefined && colMap['PnL'] !== undefined) {
     return parseCustomGenericCsv(lines, colMap);
  } else if (colMap['Net P&L USD'] !== undefined || colMap['Profit USD'] !== undefined) {
     return parseStandardTradingView(lines, colMap);
  } else {
     // Try to be lenient and look for just PnL column
     const pnlCol = Object.keys(colMap).find(k => k.toLowerCase().includes('p&l') || k.toLowerCase().includes('profit') || k === 'PnL');
     if (pnlCol) {
         return parseStandardTradingView(lines, colMap); // Attempt standard
     }
     
     console.error("Unknown CSV format. Headers found:", headers);
     throw new Error(`Invalid CSV format. Could not detect PnL column (e.g. 'net_pnl', 'PnL', or 'Net P&L USD').`);
  }
};

const parseCustomGenericCsv = (lines: string[], colMap: Record<string, number>): Trade[] => {
    const trades: Trade[] = [];

    for (let i = 1; i < lines.length; i++) {
        const row = parseCSVRow(lines[i]);
        if (row.length < Object.keys(colMap).length * 0.5) continue;

        const id = row[colMap['Id']];
        const pnlRaw = row[colMap['PnL']];
        const entryTime = row[colMap['EnteredAt']] || '';
        const exitTime = row[colMap['ExitedAt']] || '';
        const entryPriceRaw = row[colMap['EntryPrice']];
        const exitPriceRaw = row[colMap['ExitPrice']];
        const typeRaw = row[colMap['Type']];

        if (!pnlRaw) continue;

        const pnl = parseFloat(pnlRaw.replace(/[$,]/g, ''));
        if (isNaN(pnl)) continue;

        const entryPrice = parseFloat(entryPriceRaw);
        const exitPrice = parseFloat(exitPriceRaw);

        let type: 'Long' | 'Short' = 'Long';
        if (typeRaw && typeRaw.toLowerCase().includes('short')) {
            type = 'Short';
        }

        let pnlPercent = 0;
        if (!isNaN(entryPrice) && !isNaN(exitPrice) && entryPrice !== 0) {
            if (type === 'Long') {
                pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
            } else {
                pnlPercent = ((entryPrice - exitPrice) / entryPrice) * 100;
            }
        }

        // Fallback MAE/MFE as they are not explicitly in this format
        let mfe: number | undefined = undefined;
        let mae: number | undefined = undefined;
        
        if (pnl >= 0) {
            mfe = pnl;
            mae = 0;
        } else {
            mfe = 0;
            mae = pnl;
        }

        trades.push({
            id: id || i.toString(),
            entryTime,
            exitTime,
            type,
            pnl,
            pnlPercent,
            entryPrice: isNaN(entryPrice) ? undefined : entryPrice,
            exitPrice: isNaN(exitPrice) ? undefined : exitPrice,
            mae,
            mfe
        });
    }

    return trades;
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
        
        // MAE/MFE
        const runUpRaw = row[colMap['run_up_usd']] || row[colMap['run_up']];
        const drawDownRaw = row[colMap['drawdown_usd']] || row[colMap['drawdown']];

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
        
        // Parse MAE/MFE
        let mfe: number | undefined;
        let mae: number | undefined;
        if (runUpRaw) {
             mfe = parseFloat(runUpRaw.replace(/[$,]/g, ''));
             if (isNaN(mfe)) mfe = undefined;
        }
        if (drawDownRaw) {
             // MAE is a drawdown, so typically we want it negative for charts. 
             // TV usually provides it as absolute USD.
             const val = parseFloat(drawDownRaw.replace(/[$,]/g, ''));
             if (!isNaN(val)) mae = -Math.abs(val); 
        }

        // Fallback: If no explicit MAE/MFE data, estimate from PnL (Min bound)
        if (mfe === undefined && mae === undefined) {
            if (pnl >= 0) {
                mfe = pnl; // Best case: Price reached exit target
                mae = 0;   // Best case: No drawdown
            } else {
                mfe = 0;   // Worst case: No profit excursion
                mae = pnl; // Worst case: Drawdown equal to loss
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
            exitPrice: isNaN(exitPrice) ? undefined : exitPrice,
            mae,
            mfe
        });
    }

    return trades;
};

const parseStandardTradingView = (lines: string[], colMap: Record<string, number>): Trade[] => {
    const uniqueTrades = new Map<string, Trade>();
    
    // Identify key columns
    const idCol = colMap['Trade #'] ?? colMap['Id'];
    const typeCol = colMap['Type'];
    const pnlCol = colMap['Net P&L USD'] !== undefined ? colMap['Net P&L USD'] : 
                   colMap['Profit USD'] !== undefined ? colMap['Profit USD'] :
                   colMap['PnL'];
                   
    const pnlPercentCol = colMap['Net P&L %'] !== undefined ? colMap['Net P&L %'] : colMap['Profit %'];
    
    // Date/Time variants
    const entryDateCol = colMap['Date/Time'] ?? colMap['Date and time'] ?? colMap['Entry Date/Time'] ?? colMap['EnteredAt'];
    const exitDateCol = colMap['Exit Date/Time'] ?? colMap['ExitedAt'];

    // Price variants
    const entryPriceCol = colMap['Price'] ?? colMap['Entry Price'] ?? colMap['EntryPrice'];
    const exitPriceCol = colMap['Exit Price'] ?? colMap['ExitPrice'];
    
    // MAE/MFE variants
    // "Run-up USD" / "Drawdown USD"
    const runUpCol = colMap['Run-up USD'];
    const drawDownCol = colMap['Drawdown USD'];

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

            // Calculate percent if missing but prices exist
            if (pnlPercent === 0 && entryPrice && exitPrice) {
                 if (type === 'Long') {
                    pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
                 } else {
                    pnlPercent = ((entryPrice - exitPrice) / entryPrice) * 100;
                 }
            }
            
            // MAE / MFE
            let mfe: number | undefined;
            let mae: number | undefined;
            
            if (runUpCol !== undefined && row[runUpCol]) {
                const val = parseFloat(row[runUpCol].replace(/[$,]/g, ''));
                if (!isNaN(val)) mfe = val;
            }
            if (drawDownCol !== undefined && row[drawDownCol]) {
                 const val = parseFloat(row[drawDownCol].replace(/[$,]/g, ''));
                 if (!isNaN(val)) mae = -Math.abs(val); // Ensure negative
            }

            // Fallback: If no explicit MAE/MFE data, estimate from PnL (Min bound)
            if (mfe === undefined && mae === undefined) {
                if (pnl >= 0) {
                    mfe = pnl; // Price reached at least the profit taken
                    mae = 0;   // Assume perfect entry
                } else {
                    mfe = 0;   // Assume price went straight down
                    mae = pnl; // Price dropped to at least the loss taken
                }
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
                exitPrice,
                mae,
                mfe
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
