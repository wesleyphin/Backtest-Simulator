import React, { useEffect, useRef, useState, useMemo } from 'react';
import Plotly from 'plotly.js-dist';
import { Trade } from '../types';
import { Box, Layers, Activity, Calendar, BarChart2, Filter, AlertCircle, CandlestickChart, Timer, TrendingUp, Grid, Wind, Clock } from 'lucide-react';

interface Props {
  trades: Trade[];
}

type MetricType = 'regime' | 'trend' | 'volatility' | 'volume' | 'price_action' | 'efficiency' | 'hourly_density' | 'duration_pnl_winrate';
type SideType = 'all' | 'long' | 'short';

// Wrap in React.memo to prevent re-renders when parent state (like sim progress) changes
const ThreeDScatter: React.FC<Props> = React.memo(({ trades }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [metric, setMetric] = useState<MetricType>('price_action');
  const [side, setSide] = useState<SideType>('all');
  
  // New State for Visualization Options
  const [gridSize, setGridSize] = useState<number>(25);
  const [smoothing, setSmoothing] = useState<number>(2);

  // Filter trades based on side
  const filteredTrades = useMemo(() => {
    if (side === 'all') return trades;
    return trades.filter(t => t.type.toLowerCase() === side);
  }, [trades, side]);

  useEffect(() => {
    if (!chartRef.current) return;
    
    // If no trades, purge and return (UI will show empty state)
    if (filteredTrades.length === 0) {
        Plotly.purge(chartRef.current);
        return;
    }

    const config = { displayModeBar: false, responsive: true };
    
    // --- MODE: SCATTER (Individual Trades) ---
    if (metric === 'price_action') {
        // X: Trade Sequence
        // Y: Entry Price
        // Z: PnL
        const xValues = filteredTrades.map((_, i) => i);
        const yValues = filteredTrades.map(t => t.entryPrice || 0);
        const zValues = filteredTrades.map(t => t.pnl);
        const texts = filteredTrades.map(t => `Trade #${t.id}<br>Price: ${t.entryPrice}<br>PnL: $${t.pnl}`);

        const hasPrice = yValues.some(p => p > 0);
        
        // Calculate symmetric range for colorscale to ensure 0 is centered
        const maxAbsPnl = Math.max(...zValues.map(Math.abs));
        
        const data = [{
            x: xValues,
            y: yValues,
            z: zValues,
            mode: 'markers',
            type: 'scatter3d',
            marker: {
                size: 5,
                color: zValues,
                colorscale: [
                    [0, '#ef4444'],     // Red (Max Loss)
                    [0.5, '#f5f5f5'],   // White/Gray (Breakeven)
                    [1, '#10b981']      // Green (Max Profit)
                ],
                cmin: -maxAbsPnl,
                cmax: maxAbsPnl,
                showscale: true,
                colorbar: {
                    title: 'PnL ($)',
                    x: 1,
                    thickness: 15,
                    len: 0.6,
                    tickfont: { color: '#888' },
                    titlefont: { color: '#888' }
                },
                opacity: 0.9,
                line: {
                    width: 0.5,
                    color: 'rgba(100, 100, 100, 0.5)'
                }
            },
            text: texts,
            hoverinfo: 'text'
        }];

        const layout = {
            autosize: true,
            margin: { l: 0, r: 0, b: 0, t: 0 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            scene: {
                xaxis: { title: 'Trade Sequence', color: '#888888', gridcolor: '#333333', showbackground: false },
                yaxis: { title: hasPrice ? 'Entry Price' : 'Price (N/A)', color: '#888888', gridcolor: '#333333', showbackground: false },
                zaxis: { title: 'PnL ($)', color: '#888888', gridcolor: '#333333', showbackground: false },
                camera: { eye: { x: 1.6, y: 1.6, z: 1.2 } },
                aspectmode: 'cube'
            }
        };

        Plotly.newPlot(chartRef.current, data as any, layout as any, config);
        return;
    }

    // --- MODE: SURFACE (Aggregated Clusters) ---

    // --- 1. Define Grid Configuration based on Metric ---
    let xLabel = '';
    let yLabel = '';
    let zLabel = '';
    let xValues: number[] = [];
    let yValues: number[] = [];
    let zValues: number[] = []; // Raw Z for aggregation
    
    let xMin = 0, xMax = 0, yMin = 0, yMax = 0;

    // Helper to get day of week (1-7)
    const getDay = (d: string) => { const day = new Date(d).getDay(); return day === 0 ? 7 : day; };
    const getHour = (d: string) => { const h = new Date(d).getHours(); return isNaN(h) ? 12 : h; };
    const getDuration = (t: Trade) => {
        const start = new Date(t.entryTime).getTime();
        const end = new Date(t.exitTime).getTime();
        if (isNaN(start) || isNaN(end)) return 0;
        const diff = (end - start) / (1000 * 60); // minutes
        return diff > 0 ? diff : 0;
    };

    // --- 2. Extract Data Dimensions ---
    if (metric === 'regime') {
        // X: Hour (0-24), Y: Day (1-7), Z: PnL
        xLabel = 'Hour of Day';
        yLabel = 'Day of Week';
        zLabel = 'Avg PnL ($)';
        xMin = 0; xMax = 24;
        yMin = 1; yMax = 7;
        
        filteredTrades.forEach(t => {
            xValues.push(getHour(t.entryTime));
            yValues.push(getDay(t.entryTime));
            zValues.push(t.pnl);
        });
    } else if (metric === 'trend') {
        // X: Trade Index (Time), Y: Duration, Z: PnL
        xLabel = 'Trade Sequence';
        yLabel = 'Duration (min)';
        zLabel = 'PnL ($)';
        xMin = 0; xMax = filteredTrades.length;
        
        const durations = filteredTrades.map(getDuration);
        yMin = 0; 
        yMax = Math.max(...durations);
        if (yMax === 0) yMax = 10; // Default buffer if no duration data
        else yMax *= 0.8; // Cut outliers visually

        filteredTrades.forEach((t, i) => {
            xValues.push(i);
            yValues.push(getDuration(t));
            zValues.push(t.pnl);
        });
    } else if (metric === 'volatility') {
        // X: Duration, Y: PnL % (Abs), Z: Density (Clustering)
        xLabel = 'Duration (min)';
        yLabel = 'PnL %';
        zLabel = 'Cluster Density';
        const durations = filteredTrades.map(getDuration);
        const pnls = filteredTrades.map(t => t.pnlPercent);
        
        xMin = 0; 
        xMax = Math.max(...durations);
        if (xMax === 0) xMax = 10;
        else xMax *= 0.8;

        yMin = Math.min(...pnls); 
        yMax = Math.max(...pnls);

        filteredTrades.forEach(t => {
            xValues.push(getDuration(t));
            yValues.push(t.pnlPercent);
            zValues.push(1); // Just counting occurrence
        });
    } else if (metric === 'volume') {
        // X: Hour, Y: Duration, Z: Trade Count
        xLabel = 'Hour of Day';
        yLabel = 'Duration (min)';
        zLabel = 'Trade Volume';
        xMin = 0; xMax = 24;
        
        const durations = filteredTrades.map(getDuration);
        yMin = 0; 
        yMax = Math.max(...durations);
        if (yMax === 0) yMax = 10;
        else yMax *= 0.8;

        filteredTrades.forEach(t => {
            xValues.push(getHour(t.entryTime));
            yValues.push(getDuration(t));
            zValues.push(1);
        });
    } else if (metric === 'efficiency') {
        // X: Duration, Y: Hour, Z: Win Rate
        xLabel = 'Duration (min)';
        yLabel = 'Hour of Day';
        zLabel = 'Win Rate (%)';
        
        const durations = filteredTrades.map(getDuration);
        xMin = 0; 
        xMax = Math.max(...durations);
        if (xMax === 0) xMax = 10;
        else xMax *= 0.8; 

        yMin = 0; yMax = 24;

        filteredTrades.forEach(t => {
            xValues.push(getDuration(t));
            yValues.push(getHour(t.entryTime));
            zValues.push(t.pnl > 0 ? 100 : 0);
        });
    } else if (metric === 'hourly_density') {
        // X: Hour, Y: PnL, Z: Volume
        xLabel = 'Hour of Day';
        yLabel = 'PnL ($)';
        zLabel = 'Trade Volume';
        
        xMin = 0; xMax = 24;
        
        const pnls = filteredTrades.map(t => t.pnl);
        yMin = Math.min(...pnls);
        yMax = Math.max(...pnls);

        filteredTrades.forEach(t => {
            xValues.push(getHour(t.entryTime));
            yValues.push(t.pnl);
            zValues.push(1);
        });
    } else if (metric === 'duration_pnl_winrate') {
        // X: Duration, Y: Abs PnL (Volatility Magnitude), Z: Win Rate
        xLabel = 'Duration (min)';
        yLabel = 'Abs PnL ($)';
        zLabel = 'Win Rate (%)';
        
        const durations = filteredTrades.map(getDuration);
        const absPnls = filteredTrades.map(t => Math.abs(t.pnl));
        
        xMin = 0; 
        xMax = Math.max(...durations);
        if (xMax === 0) xMax = 10;
        else xMax *= 0.8;

        yMin = 0;
        yMax = Math.max(...absPnls);

        filteredTrades.forEach(t => {
            xValues.push(getDuration(t));
            yValues.push(Math.abs(t.pnl));
            zValues.push(t.pnl > 0 ? 100 : 0);
        });
    }

    // Safety check for range 0 (prevents division by zero)
    if (xMax <= xMin) xMax = xMin + 1;
    if (yMax <= yMin) yMax = yMin + 1;

    // --- 3. Binning & Mesh Generation ---
    const zGrid: number[][] = Array(gridSize).fill(0).map(() => Array(gridSize).fill(0));
    const countGrid: number[][] = Array(gridSize).fill(0).map(() => Array(gridSize).fill(0));
    
    // Create axis ticks for plot
    const xStep = (xMax - xMin) / gridSize;
    const yStep = (yMax - yMin) / gridSize;
    const xTickLabels = Array(gridSize).fill(0).map((_, i) => xMin + i * xStep);
    const yTickLabels = Array(gridSize).fill(0).map((_, i) => yMin + i * yStep);

    // Fill Grid
    for (let i = 0; i < xValues.length; i++) {
        const xIdx = Math.min(Math.floor((xValues[i] - xMin) / xStep), gridSize - 1);
        const yIdx = Math.min(Math.floor((yValues[i] - yMin) / yStep), gridSize - 1);
        
        // Ensure indices are valid (handle NaNs or Infinities just in case)
        if (xIdx >= 0 && xIdx < gridSize && yIdx >= 0 && yIdx < gridSize) {
            zGrid[yIdx][xIdx] += zValues[i];
            countGrid[yIdx][xIdx] += 1;
        }
    }

    // Average or Sum based on metric
    for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
            if (countGrid[y][x] > 0) {
                if (metric === 'regime' || metric === 'trend' || metric === 'efficiency' || metric === 'duration_pnl_winrate') {
                    zGrid[y][x] /= countGrid[y][x]; // Average PnL or Win Rate
                }
                // For Volatility/Volume/HourlyDensity, we keep the Sum (Density)
            }
        }
    }

    // --- 4. Gaussian Smoothing (Convolution) ---
    // Makes the surface look like a terrain/cluster map
    const smoothZ = (grid: number[][]) => {
        const kernel = [
            [0.0625, 0.125, 0.0625],
            [0.125,  0.25,  0.125],
            [0.0625, 0.125, 0.0625]
        ];
        const rows = grid.length;
        const cols = grid[0].length;
        const newGrid = grid.map(row => [...row]);

        // Apply 1 pass of smoothing
        for (let y = 1; y < rows - 1; y++) {
            for (let x = 1; x < cols - 1; x++) {
                let sum = 0;
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        sum += grid[y + ky][x + kx] * kernel[ky + 1][kx + 1];
                    }
                }
                newGrid[y][x] = sum;
            }
        }
        return newGrid;
    };

    // Apply smoothing iteratively based on user setting
    let smoothedZ = zGrid;
    for (let i = 0; i < smoothing; i++) {
        smoothedZ = smoothZ(smoothedZ);
    }

    // --- 5. Render Plotly ---
    const isDensity = metric === 'volatility' || metric === 'volume' || metric === 'hourly_density';
    
    const data = [{
        z: smoothedZ,
        x: xTickLabels,
        y: yTickLabels,
        type: 'surface',
        contours: {
            z: {
                show: true,
                usecolormap: true,
                highlightcolor: "#42f462",
                project: { z: true }
            }
        },
        colorscale: isDensity ? 'Viridis' : 'RdBu',
        showscale: false,
        opacity: 0.9
    }];

    const surfaceLayout = {
      autosize: true,
      margin: { l: 0, r: 0, b: 0, t: 0 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      scene: {
        xaxis: { title: xLabel, color: '#888888', gridcolor: '#333333', showbackground: false },
        yaxis: { title: yLabel, color: '#888888', gridcolor: '#333333', showbackground: false },
        zaxis: { title: zLabel, color: '#888888', gridcolor: '#333333', showbackground: false },
        camera: { eye: { x: 1.5, y: 1.5, z: 1.2 } },
        aspectmode: 'cube'
      }
    };

    Plotly.newPlot(chartRef.current, data as any, surfaceLayout as any, config);

    return () => {
        if(chartRef.current) {
            Plotly.purge(chartRef.current);
        }
    };
  }, [filteredTrades, metric, gridSize, smoothing]); 

  return (
    <div className="bg-surface rounded-xl border border-neutral-800 shadow-xl h-[600px] flex flex-col overflow-hidden relative">
       
       {/* Controls Header */}
       <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
            
            {/* Side Toggle */}
            <div className="flex bg-neutral-900/80 backdrop-blur-md rounded-lg p-1 border border-neutral-800 shadow-lg">
                {(['all', 'long', 'short'] as const).map((s) => (
                    <button
                        key={s}
                        onClick={() => setSide(s)}
                        className={`px-3 py-1.5 text-xs font-bold uppercase rounded-md transition-all ${
                            side === s 
                            ? 'bg-primary text-black shadow-sm' 
                            : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                        }`}
                    >
                        {s}
                    </button>
                ))}
            </div>

            {/* Metric Toggle */}
            <div className="flex flex-col bg-neutral-900/80 backdrop-blur-md rounded-lg border border-neutral-800 shadow-lg overflow-hidden">
                <button onClick={() => setMetric('price_action')} className={`flex items-center gap-2 px-4 py-2 text-left text-xs font-medium transition-colors ${metric === 'price_action' ? 'bg-neutral-800 text-purple-400' : 'text-neutral-400 hover:text-neutral-200'}`}>
                    <CandlestickChart className="w-3 h-3" /> Price Action
                </button>
                <div className="h-px bg-neutral-800 my-1 mx-2"></div>
                <button onClick={() => setMetric('regime')} className={`flex items-center gap-2 px-4 py-2 text-left text-xs font-medium transition-colors ${metric === 'regime' ? 'bg-neutral-800 text-emerald-400' : 'text-neutral-400 hover:text-neutral-200'}`}>
                    <Calendar className="w-3 h-3" /> Regime (Time)
                </button>
                <button onClick={() => setMetric('trend')} className={`flex items-center gap-2 px-4 py-2 text-left text-xs font-medium transition-colors ${metric === 'trend' ? 'bg-neutral-800 text-blue-400' : 'text-neutral-400 hover:text-neutral-200'}`}>
                    <TrendingUp className="w-3 h-3" /> Trend (Seq)
                </button>
                <button onClick={() => setMetric('efficiency')} className={`flex items-center gap-2 px-4 py-2 text-left text-xs font-medium transition-colors ${metric === 'efficiency' ? 'bg-neutral-800 text-lime-400' : 'text-neutral-400 hover:text-neutral-200'}`}>
                    <Timer className="w-3 h-3" /> Efficiency (WR%)
                </button>
                <div className="h-px bg-neutral-800 my-1 mx-2"></div>
                <button onClick={() => setMetric('volatility')} className={`flex items-center gap-2 px-4 py-2 text-left text-xs font-medium transition-colors ${metric === 'volatility' ? 'bg-neutral-800 text-rose-400' : 'text-neutral-400 hover:text-neutral-200'}`}>
                    <Activity className="w-3 h-3" /> Volatility (PnL%)
                </button>
                <button onClick={() => setMetric('duration_pnl_winrate')} className={`flex items-center gap-2 px-4 py-2 text-left text-xs font-medium transition-colors ${metric === 'duration_pnl_winrate' ? 'bg-neutral-800 text-indigo-400' : 'text-neutral-400 hover:text-neutral-200'}`}>
                    <Clock className="w-3 h-3" /> Efficiency (Dur/Vol)
                </button>
                <button onClick={() => setMetric('volume')} className={`flex items-center gap-2 px-4 py-2 text-left text-xs font-medium transition-colors ${metric === 'volume' ? 'bg-neutral-800 text-amber-400' : 'text-neutral-400 hover:text-neutral-200'}`}>
                    <BarChart2 className="w-3 h-3" /> Volume (Dur)
                </button>
                <button onClick={() => setMetric('hourly_density')} className={`flex items-center gap-2 px-4 py-2 text-left text-xs font-medium transition-colors ${metric === 'hourly_density' ? 'bg-neutral-800 text-orange-400' : 'text-neutral-400 hover:text-neutral-200'}`}>
                    <BarChart2 className="w-3 h-3" /> Vol (Hr/PnL)
                </button>
            </div>
       
            {/* Surface Controls (Only for Surface Modes) */}
            {metric !== 'price_action' && (
                <div className="flex flex-col bg-neutral-900/80 backdrop-blur-md rounded-lg border border-neutral-800 shadow-lg p-3 gap-3 animate-in fade-in slide-in-from-top-2">
                     {/* Resolution */}
                     <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5 text-neutral-500">
                            <Grid className="w-3 h-3" />
                            <span className="text-[10px] uppercase font-bold tracking-wide">Grid Resolution</span>
                        </div>
                        <div className="flex gap-1">
                            {[15, 25, 40].map(r => (
                                <button 
                                    key={r} 
                                    onClick={() => setGridSize(r)}
                                    className={`flex-1 px-1 py-1 text-[10px] font-medium rounded transition-colors ${gridSize === r ? 'bg-primary text-black' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}
                                >
                                    {r === 15 ? 'Low' : r === 25 ? 'Med' : 'High'}
                                </button>
                            ))}
                        </div>
                     </div>

                     {/* Smoothing */}
                     <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5 text-neutral-500">
                            <Wind className="w-3 h-3" />
                            <span className="text-[10px] uppercase font-bold tracking-wide">Smoothing</span>
                        </div>
                        <div className="flex gap-1">
                             {[0, 1, 3].map(s => (
                                <button 
                                    key={s} 
                                    onClick={() => setSmoothing(s)}
                                    className={`flex-1 px-1 py-1 text-[10px] font-medium rounded transition-colors ${smoothing === s ? 'bg-primary text-black' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}
                                >
                                    {s === 0 ? 'Off' : s === 1 ? 'Low' : 'High'}
                                </button>
                            ))}
                        </div>
                     </div>
                </div>
            )}
       </div>

       <div className="flex items-center justify-end p-4 border-b border-neutral-800 bg-neutral-900/30">
            <div className="flex items-center gap-2">
                <Box className="w-5 h-5 text-primary" />
                <h3 className="font-semibold text-neutral-200">3D Trade Visualization</h3>
            </div>
       </div>

       <div ref={chartRef} className="flex-1 w-full relative">
            {filteredTrades.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-900/50 backdrop-blur-sm z-20">
                    <AlertCircle className="w-12 h-12 text-neutral-500 mb-2" />
                    <p className="text-neutral-400 font-medium">No trades found for this filter.</p>
                </div>
            )}
       </div>
    </div>
  );
});

export default ThreeDScatter;