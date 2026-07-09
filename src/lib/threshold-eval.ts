export interface LabeledArticle {
  title: string;
  description: string | null;
  relevant: boolean; // 正解ラベル
}

export interface LabeledSample {
  keyword: string;
  articles: LabeledArticle[];
}

export interface ScoredArticle {
  similarity: number;
  relevant: boolean;
}

export interface ThresholdResult {
  threshold: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number; // 0除算時は 0
  recall: number; // 0除算時は 0
  f1: number; // 0除算時は 0
}

/**
 * 1つの閾値で全スコア済み記事を評価
 */
export function evaluateThreshold(scored: ScoredArticle[], threshold: number): ThresholdResult {
  let tp = 0; // 予測かつ正解
  let fp = 0; // 予測かつ不正解
  let fn = 0; // 非予測かつ正解
  let tn = 0; // 非予測かつ不正解

  for (const item of scored) {
    const predicted = item.similarity >= threshold;
    if (predicted && item.relevant) tp++;
    else if (predicted && !item.relevant) fp++;
    else if (!predicted && item.relevant) fn++;
    else if (!predicted && !item.relevant) tn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { threshold, tp, fp, fn, tn, precision, recall, f1 };
}

/**
 * 閾値をスイープして各閾値の結果を配列で返す（thresholds 配列を受け取る）
 */
export function sweepThresholds(scored: ScoredArticle[], thresholds: number[]): ThresholdResult[] {
  return thresholds.map((threshold) => evaluateThreshold(scored, threshold));
}

export interface ThresholdRecommendation {
  maxF1Threshold: number;
  maxF1: number;
  recallTargetThreshold: number | null; // 条件を満たす閾値がなければ null
  recallTarget: number;
}

/**
 * 推奨閾値を決定: maxF1 の閾値、および recall >= recallTarget を満たす最小の閾値
 */
export function recommendThreshold(
  results: ThresholdResult[],
  recallTarget = 0.85,
): ThresholdRecommendation {
  // maxF1 を求める
  let maxF1 = -1;
  let maxF1Threshold = 0;

  for (const result of results) {
    if (result.f1 > maxF1 || (result.f1 === maxF1 && result.threshold < maxF1Threshold)) {
      maxF1 = result.f1;
      maxF1Threshold = result.threshold;
    }
  }

  // recall >= recallTarget を満たす最小の閾値を求める
  let recallTargetThreshold: number | null = null;
  for (const result of results) {
    if (result.recall >= recallTarget) {
      if (recallTargetThreshold === null || result.threshold < recallTargetThreshold) {
        recallTargetThreshold = result.threshold;
      }
    }
  }

  return { maxF1Threshold, maxF1, recallTargetThreshold, recallTarget };
}

/**
 * オフライン用決定論的モック埋め込み: トークンのハッシュ→固定次元ベクトル（正規化済）
 * トークンは小文字化し非英数字で分割。dim はデフォルト 256。
 */
export function hashEmbed(text: string, dim = 256): number[] {
  // 決定論的なハッシュ関数
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  const vector = new Array(dim).fill(0);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    // シンプルなハッシュ: トークンの文字コードの合計
    let hash = 0;
    for (let j = 0; j < token.length; j++) {
      hash = (hash * 31 + token.charCodeAt(j)) % dim;
    }
    // 各トークンを異なるインデックスに配置
    const index = Math.abs(hash) % dim;
    // トークンの重み付け（長さによる）
    const weight = token.length / 10; // トークン長に基づく重み付け
    vector[index] += weight;
  }

  // ベクトルを正規化
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (norm === 0) return vector; // ゼロベクトルの場合はそのまま返す

  return vector.map((val) => val / norm);
}
