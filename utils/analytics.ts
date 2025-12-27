import { Trade } from '../types';

export interface RegressionResult {
  feature: string;
  coefficient: number; // Slope
  correlation: number; // Pearson r
  importance: number; // |r|
  rSquared: number;
  tStat?: number;
}

export interface SegmentedAnalysis {
  all: RegressionResult[];
  long: RegressionResult[];
  short: RegressionResult[];
}

const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

const stdDev = (arr: number[], mu: number) => {
  if (arr.length <= 1) return 0;
  const variance = arr.reduce((acc, val) => acc + Math.pow(val - mu, 2), 0) / (arr.length - 1);
  return Math.sqrt(variance);
};

// Calculate Pearson Correlation and Simple Linear Regression Slope
const analyzeFeature = (x: number[], y: number[], featureName: string): RegressionResult => {
  const n = x.length;
  if (n < 2) return { feature: featureName, coefficient: 0, correlation: 0, importance: 0, rSquared: 0 };

  // Check variance
  const uniqueX = new Set(x);
  if (uniqueX.size < 2) return { feature: featureName, coefficient: 0, correlation: 0, importance: 0, rSquared: 0 };

  const muX = mean(x);
  const muY = mean(y);
  
  const stdX = stdDev(x, muX);
  const stdY = stdDev(y, muY);

  let covariance = 0;
  for (let i = 0; i < n; i++) {
    covariance += (x[i] - muX) * (y[i] - muY);
  }
  covariance /= (n - 1);

  const correlation = (stdX * stdY) === 0 ? 0 : covariance / (stdX * stdY);
  const slope = (stdX === 0) ? 0 : correlation * (stdY / stdX);

  return {
    feature: featureName,
    coefficient: slope,
    correlation,
    importance: Math.abs(correlation),
    rSquared: correlation * correlation
  };
};

const runAnalysisOnSubset = (trades: Trade[]): RegressionResult[] => {
  if (trades.length < 5) return [];

  const y = trades.map(t => t.pnl);

  // Feature 1: Entry Hour
  const xHour = trades.map(t => {
    const d = new Date(t.entryTime);
    return isNaN(d.getTime()) ? 12 : d.getHours();
  });

  // Feature 2: Day of Week (Monday=1...Sunday=7)
  const xDay = trades.map(t => {
    const d = new Date(t.entryTime);
    const day = d.getDay(); 
    return day === 0 ? 7 : day;
  });

  // Feature 3: Trade Sequence (Trend)
  const xSequence = trades.map((_, i) => i);

  // Feature 4: Previous Trade Result (Win/Loss streakiness)
  const xPrevResult = trades.map((_, i) => {
      if (i === 0) return 0;
      return trades[i-1].pnl > 0 ? 1 : -1;
  });

  const results = [
    analyzeFeature(xHour, y, "Entry Hour"),
    analyzeFeature(xDay, y, "Day of Week"),
    analyzeFeature(xSequence, y, "Sequence (Trend)"),
    analyzeFeature(xPrevResult, y, "Prev. Outcome")
  ];

  return results.sort((a, b) => b.importance - a.importance);
};

export const performRegressionAnalysis = (trades: Trade[]): SegmentedAnalysis => {
  const longs = trades.filter(t => t.type === 'Long');
  const shorts = trades.filter(t => t.type === 'Short');

  return {
    all: runAnalysisOnSubset(trades),
    long: runAnalysisOnSubset(longs),
    short: runAnalysisOnSubset(shorts)
  };
};

export const calculateDistributionStats = (values: number[]) => {
  const n = values.length;
  if (n < 2) return { skew: 0, kurtosis: 0, mean: 0, stdDev: 0 };

  const mu = values.reduce((a, b) => a + b, 0) / n;
  
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;

  for (const val of values) {
    const delta = val - mu;
    m2 += Math.pow(delta, 2);
    m3 += Math.pow(delta, 3);
    m4 += Math.pow(delta, 4);
  }

  m2 /= n;
  m3 /= n;
  m4 /= n;

  const stdDev = Math.sqrt(m2);
  
  if (m2 === 0) return { skew: 0, kurtosis: 0, mean: mu, stdDev: 0 };

  const skew = m3 / Math.pow(m2, 1.5);
  const kurtosis = (m4 / Math.pow(m2, 2)) - 3; // Excess Kurtosis

  return { skew, kurtosis, mean: mu, stdDev };
};