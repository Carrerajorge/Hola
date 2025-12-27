export interface ComplexityResult {
  score: number;
  category: 'trivial' | 'simple' | 'moderate' | 'complex' | 'architectural';
  signals: string[];
  recommended_path: 'fast' | 'standard' | 'orchestrated' | 'architect';
  estimated_tokens: number;
  dimensions: {
    cognitive_load: number;
    domain_breadth: number;
    steps_required: number;
    ambiguity_level: number;
    technical_depth: number;
  };
}

export class ComplexityAnalyzer {
  private cache: Map<string, {result: ComplexityResult, timestamp: number}> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  analyze(prompt: string): ComplexityResult {
    const cached = this.getFromCache(prompt);
    if (cached) return cached;

    const dimensions = {
      cognitive_load: this.analyzeCognitiveLoad(prompt),
      domain_breadth: this.analyzeDomainBreadth(prompt),
      steps_required: this.analyzeStepsRequired(prompt),
      ambiguity_level: this.analyzeAmbiguity(prompt),
      technical_depth: this.analyzeTechnicalDepth(prompt)
    };

    const score = Math.round(
      dimensions.cognitive_load * 0.25 +
      dimensions.domain_breadth * 0.2 +
      dimensions.steps_required * 0.2 +
      dimensions.ambiguity_level * 0.15 +
      dimensions.technical_depth * 0.2
    );

    const result: ComplexityResult = {
      score,
      category: this.scoreToCategory(score),
      signals: this.detectSignals(prompt, dimensions),
      recommended_path: this.getRecommendedPath(score),
      estimated_tokens: this.estimateTokens(prompt, score),
      dimensions
    };

    this.setCache(prompt, result);
    return result;
  }

  private analyzeCognitiveLoad(prompt: string): number {
    const complexWords = ['analyze', 'design', 'architect', 'implement', 'optimize', 'debug', 'refactor', 'analizar', 'diseñar', 'implementar', 'optimizar'];
    const simpleWords = ['what', 'when', 'who', 'define', 'qué', 'cuándo', 'quién', 'define'];
    let score = 3;
    complexWords.forEach(w => { if (prompt.toLowerCase().includes(w)) score += 1; });
    simpleWords.forEach(w => { if (prompt.toLowerCase().includes(w)) score -= 0.5; });
    return Math.max(1, Math.min(10, score));
  }

  private analyzeDomainBreadth(prompt: string): number {
    const domains = ['database', 'frontend', 'backend', 'security', 'api', 'auth', 'ui', 'ux', 'testing', 'deploy', 'devops', 'base de datos', 'seguridad'];
    let count = 0;
    domains.forEach(d => { if (prompt.toLowerCase().includes(d)) count++; });
    return Math.min(10, 1 + count * 2);
  }

  private analyzeStepsRequired(prompt: string): number {
    const multiStepIndicators = ['then', 'after', 'next', 'step', 'first', 'finally', 'luego', 'después', 'paso', 'primero', 'finalmente', 'and', 'y', 'also', 'también'];
    let count = 0;
    multiStepIndicators.forEach(w => { if (prompt.toLowerCase().includes(w)) count++; });
    return Math.min(10, 2 + count);
  }

  private analyzeAmbiguity(prompt: string): number {
    const wordCount = prompt.split(/\s+/).length;
    if (wordCount < 5) return 8;
    if (wordCount < 10) return 5;
    if (wordCount < 20) return 3;
    return 2;
  }

  private analyzeTechnicalDepth(prompt: string): number {
    const techTerms = ['algorithm', 'database', 'api', 'jwt', 'oauth', 'websocket', 'redis', 'sql', 'nosql', 'microservice', 'kubernetes', 'docker', 'cache', 'index', 'transaction', 'migration', 'algoritmo', 'arquitectura'];
    let score = 2;
    techTerms.forEach(t => { if (prompt.toLowerCase().includes(t)) score += 1; });
    return Math.min(10, score);
  }

  private scoreToCategory(score: number): ComplexityResult['category'] {
    if (score <= 2) return 'trivial';
    if (score <= 4) return 'simple';
    if (score <= 6) return 'moderate';
    if (score <= 8) return 'complex';
    return 'architectural';
  }

  private getRecommendedPath(score: number): ComplexityResult['recommended_path'] {
    if (score <= 2) return 'fast';
    if (score <= 5) return 'standard';
    if (score <= 8) return 'orchestrated';
    return 'architect';
  }

  private detectSignals(prompt: string, dimensions: ComplexityResult['dimensions']): string[] {
    const signals: string[] = [];
    if (dimensions.cognitive_load >= 7) signals.push('high_reasoning_required');
    if (dimensions.domain_breadth >= 5) signals.push('multi_domain');
    if (dimensions.steps_required >= 6) signals.push('multi_step_task');
    if (dimensions.ambiguity_level >= 7) signals.push('needs_clarification');
    if (dimensions.technical_depth >= 7) signals.push('deep_technical');
    return signals;
  }

  private estimateTokens(prompt: string, score: number): number {
    const baseTokens = prompt.length / 4;
    const multiplier = 1 + (score * 0.5);
    return Math.round(baseTokens * multiplier);
  }

  private getCacheKey(prompt: string): string {
    let hash = 0;
    for (let i = 0; i < prompt.length; i++) {
      hash = ((hash << 5) - hash) + prompt.charCodeAt(i);
      hash = hash & hash;
    }
    return `complexity_${hash}`;
  }

  private getFromCache(prompt: string): ComplexityResult | null {
    const key = this.getCacheKey(prompt);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) return cached.result;
    if (cached) this.cache.delete(key);
    return null;
  }

  private setCache(prompt: string, result: ComplexityResult): void {
    const key = this.getCacheKey(prompt);
    this.cache.set(key, { result, timestamp: Date.now() });
    if (this.cache.size > 500) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
  }
}

export const complexityAnalyzer = new ComplexityAnalyzer();
