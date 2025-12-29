import { GoogleGenAI, Chat } from "@google/genai";
import { Statistics, Trade } from "../types";

// Initialize Gemini Client
// The API key is obtained exclusively from process.env.API_KEY per instructions.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateStrategyReport = async (
  historicalStats: any,
  mcStats: Statistics | null,
  mcConfig: any
): Promise<string> => {
  // Use Gemini 3 Pro for complex reasoning and analysis tasks
  const modelId = "gemini-3-pro-preview";

  const prompt = `
    You are a Senior Quantitative Researcher at a top-tier proprietary trading firm (e.g., Jane Street, Two Sigma). 
    Your job is to stress-test trading strategies and reject those that are curve-fitted or dangerous.
    
    Analyze the following strategy data:

    ### 1. Historical Backtest Stats
    ${JSON.stringify(historicalStats, null, 2)}

    ### 2. Monte Carlo Projections (Future Risk)
    ${JSON.stringify(mcStats, null, 2)}

    ### 3. Simulation Config
    ${JSON.stringify(mcConfig, null, 2)}

    ---
    
    ### Report Instructions:
    Provide a "Quant Report Card" using the following Markdown format. Be concise, professional, and skeptical.

    **Grade:** [A+ to F]
    **Summary:** [1 sentence summary]

    ### 1. Risk Profile
    *   **Skewness & Tails:** Analyze if the strategy has a "fat tail" risk (negative skew). 
    *   **Drawdown Reality:** Compare Historical Max DD vs Monte Carlo 99% VaR. Is the backtest underestimating risk?
    *   **Ratios:** Analyze Sharpe vs Sortino.

    ### 2. Strategy Logic
    *   **Win Rate vs R:R:** Does the Win Rate justify the Profit Factor? Is this a "sniper" (high WR) or "trend" (low WR) system?
    *   **Consistency:** Is the SQN healthy (>2.0)?

    ### 3. Prop Firm Viability
    *   Based on standard prop firm rules (typically 5% Daily Loss Limit, 10% Max Trailing Drawdown), would this strategy survive?
    *   Mention specific risks regarding the "Daily Loss Limit".

    ### 4. Verdict
    *   **Final Recommendation:** [DEPLOY / OPTIMIZE / ARCHIVE]
    *   **Key Warning:** What is the #1 thing that will kill this account?
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        temperature: 0.4, // Lower temperature for more analytical/consistent results
        systemInstruction: "You are a skeptical, mathematically rigorous Quant Researcher. You focus on downside risk and probability of ruin. You use Markdown for formatting.",
      },
    });

    return response.text || "Report generation returned empty.";
  } catch (error) {
    console.error("AI Generation Error:", error);
    return `**Error Generating Report**\n\nFailed to connect to Gemini API. \n\nDebug Info:\n- Model: ${modelId}\n- Error: ${(error as Error).message}`;
  }
};

export const createOptimizerChat = (): Chat => {
    return ai.chats.create({
        model: "gemini-3-pro-preview",
        config: {
            temperature: 0.2,
            systemInstruction: "You are a pragmatic algorithmic trader. You verify your work by simulating code execution on data samples. You prioritize risk management. You can maintain a conversation to refine strategies and fix errors.",
        },
    });
};

export const buildOptimizerPrompt = (
    strategyFiles: { name: string; content: string }[],
    marketDataFiles: { name: string; content: string }[],
    historicalStats: any,
    mcStats: Statistics | null,
    regressionStats: string
): string => {
    // Format strategy files for the prompt
    const filesContext = strategyFiles.map(f => `
    --- STRATEGY FILE: ${f.name} ---
    \`\`\`
    ${f.content}
    \`\`\`
    `).join('\n');

    // Format Data Context
    const dataContext = marketDataFiles.length > 0
        ? marketDataFiles.map(f => `
    --- MARKET DATA: ${f.name} (First 50 lines) ---
    \`\`\`csv
    ${f.content}
    \`\`\`
        `).join('\n')
        : "No specific market data file provided. Assume standard OHLCV format.";

    return `
    You are an expert Algorithmic Trading Developer and Backtesting Engine. Your task is to rewrite the provided trading strategy code to improve its performance AND verify it by running a "mental backtest" on the provided data snippets.

    --- INPUTS ---

    ### 1. Current Performance Stats
    Win Rate: ${historicalStats?.winRate.toFixed(2)}%
    Profit Factor: ${historicalStats?.profitFactor.toFixed(2)}
    Sharpe Ratio: ${historicalStats?.sharpe.toFixed(2)}

    ### 2. Monte Carlo Risk Analysis (Future Projections)
    99% Value at Risk (VaR): ${mcStats?.var99.toFixed(2)}%
    Probability of Ruin: ${mcStats?.ruinProbability.toFixed(1)}%
    Max Consecutive Losses (Simulated): ${mcStats?.worstDrawdown.toFixed(1)}%

    ### 3. Regression & Correlation Insights (Crucial for Optimization)
    ${regressionStats}

    ### 4. Codebase
    ${filesContext}

    ### 5. Market Data Context
    ${dataContext}

    --- TASK ---

    1.  **Analyze & Validate:** Identify specific weaknesses. Confirm CSV columns.
    2.  **Optimize Logic:** Rewrite the strategy to mitigate risks (high VaR) and leverage correlations.
    3.  **EXECUTE SIMULATION:** Trace your *new Optimized Strategy* logic against the rows provided in the "Market Data" snippets. 
        *   Literally "run" the code in your head row-by-row for the provided data.
        *   Identify where entries and exits would occur in those snippets.
        *   Calculate the hypothetical PnL for those specific trades.
    4.  **Generate Harness:** Write a Python/Pandas backtest script.

    --- OUTPUT FORMAT ---

    Provide the output in Markdown:

    **1. Simulation Results (AI Predicted):**
    *   **Trace Analysis:** "Running logic on ${marketDataFiles.length > 0 ? marketDataFiles[0].name : 'data'}..."
    *   **Trades Found:** List the specific timestamps and signals found in the snippets.
    *   **Hypothetical PnL:** estimated result for these specific rows.
    *   **Data Validation:** Confirmed columns found (e.g. 'Close' vs 'Adj Close').

    **2. Optimized Backtest Code:**
    *   A complete, runnable \`backtest.py\` script.
    *   **MUST** use the exact column names found in the CSV snippets.
    \`\`\`python
    # Backtest Code ...
    \`\`\`

    **3. Optimized Strategy Code:**
    *   The fully rewritten strategy file(s).
    **File: [filename]**
    \`\`\`[language]
    [Code]
    \`\`\`

    **4. Summary of Improvements:**
    *   Bullet points on risk reduction.
    `;
};

// Deprecated: Wrapper for backward compatibility if needed, but UI now uses chat directly.
export const optimizeStrategy = async (
    strategyFiles: { name: string; content: string }[],
    marketDataFiles: { name: string; content: string }[],
    historicalStats: any,
    mcStats: Statistics | null,
    regressionStats: string
): Promise<string> => {
    try {
        const chat = createOptimizerChat();
        const prompt = buildOptimizerPrompt(strategyFiles, marketDataFiles, historicalStats, mcStats, regressionStats);
        const result = await chat.sendMessage({ message: prompt });
        return result.text || "No response";
    } catch (error) {
         return `Error: ${(error as Error).message}`;
    }
};