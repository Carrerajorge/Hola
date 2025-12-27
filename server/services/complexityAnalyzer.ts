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

  private readonly TRIVIAL_PATTERNS = [
    /^(hola|hi|hello|hey|buenos días|buenas tardes|buenas noches|good morning|good afternoon|good evening)[\s!?.,]*$/i,
    /^(gracias|thanks|thank you|thx|ty|muchas gracias)[\s!?.,]*$/i,
    /^(ok|okay|sí|si|yes|no|nope|vale|bien|bueno|sure|got it)[\s!?.,]*$/i,
    /^(adiós|bye|goodbye|chao|hasta luego|see you)[\s!?.,]*$/i
  ];

  private readonly ARCHITECTURAL_PATTERNS = [
    /arquitectura|architecture/i,
    /microservicio|microservice/i,
    /millones|millions/i,
    /enterprise|empresarial/i,
    /plataforma completa|full platform|saas/i,
    /sistema distribuido|distributed system/i,
    /alta disponibilidad|high availability/i,
    /escalabilidad|scalability|scaling/i,
    /kubernetes|k8s/i,
    /infraestructura|infrastructure/i
  ];

  private readonly COMPLEX_PATTERNS = [
    /implementa|implement/i,
    /diseña|design/i,
    /sistema de|system for/i,
    /jwt|oauth|auth/i,
    /base de datos|database/i,
    /api rest|restful/i,
    /integración|integration/i,
    /seguridad|security/i
  ];

  private readonly MODERATE_PATTERNS = [
    /explica|explain/i,
    /ejemplo|example/i,
    /cómo funciona|how.*(work|function)/i,
    /diferencia|difference/i,
    /compara|compare/i,
    /debugging|debug/i,
    /async|await|promise/i
  ];

  private readonly SIMPLE_PATTERNS = [
    /\bqué es\b|\bwhat is\b/i,
    /\bdefine\b|\bdefinir\b/i,
    /\blist\b|\blistar\b/i
  ];

  analyze(prompt: string): ComplexityResult {
    const cached = this.getFromCache(prompt);
    if (cached) return cached;

    if (this.isTrivial(prompt)) {
      const result = this.createTrivialResult(prompt);
      this.setCache(prompt, result);
      return result;
    }

    const dimensions = {
      cognitive_load: this.analyzeCognitiveLoad(prompt),
      domain_breadth: this.analyzeDomainBreadth(prompt),
      steps_required: this.analyzeStepsRequired(prompt),
      ambiguity_level: this.analyzeAmbiguity(prompt),
      technical_depth: this.analyzeTechnicalDepth(prompt)
    };

    let score = Math.round(
      dimensions.cognitive_load * 0.25 +
      dimensions.domain_breadth * 0.2 +
      dimensions.steps_required * 0.2 +
      dimensions.ambiguity_level * 0.15 +
      dimensions.technical_depth * 0.2
    );

    score += this.calculateBoost(prompt);
    score = Math.max(1, Math.min(10, score));

    const result: ComplexityResult = {
      score,
      category: this.scoreToCategory(score),
      signals: this.detectSignals(prompt, dimensions, score),
      recommended_path: this.getRecommendedPath(score),
      estimated_tokens: this.estimateTokens(prompt, score),
      dimensions
    };

    this.setCache(prompt, result);
    return result;
  }

  private isTrivial(prompt: string): boolean {
    const trimmed = prompt.trim();
    if (trimmed.length < 15) {
      for (const pattern of this.TRIVIAL_PATTERNS) {
        if (pattern.test(trimmed)) return true;
      }
    }
    return trimmed.length < 5;
  }

  private createTrivialResult(prompt: string): ComplexityResult {
    return {
      score: prompt.trim().length < 10 ? 1 : 2,
      category: 'trivial',
      signals: ['trivial_pattern'],
      recommended_path: 'fast',
      estimated_tokens: Math.round(prompt.length / 4),
      dimensions: { cognitive_load: 1, domain_breadth: 1, steps_required: 1, ambiguity_level: 1, technical_depth: 1 }
    };
  }

  private calculateBoost(prompt: string): number {
    let boost = 0;
    let archCount = 0;
    let complexCount = 0;
    
    for (const pattern of this.ARCHITECTURAL_PATTERNS) {
      if (pattern.test(prompt)) archCount++;
    }
    
    for (const pattern of this.COMPLEX_PATTERNS) {
      if (pattern.test(prompt)) complexCount++;
    }

    for (const pattern of this.MODERATE_PATTERNS) {
      if (pattern.test(prompt)) {
        boost += 3;
        break;
      }
    }

    for (const pattern of this.SIMPLE_PATTERNS) {
      if (pattern.test(prompt)) {
        boost += 1;
        break;
      }
    }

    if (archCount >= 2) boost += 7;
    else if (archCount >= 1) boost += 5;

    if (complexCount >= 2) boost += 4;
    else if (complexCount >= 1) boost += 3;

    const wordCount = prompt.split(/\s+/).length;
    if (wordCount > 15) boost += 1;
    if (wordCount > 25) boost += 1;

    return boost;
  }

  private analyzeCognitiveLoad(prompt: string): number {
    const lower = prompt.toLowerCase();
    let score = 2;
    
    const highCog = ['analyze', 'analizar', 'design', 'diseñar', 'architect', 'optimize', 'optimizar', 'debug', 'refactor', 'compare', 'comparar'];
    const medCog = ['explain', 'explicar', 'implement', 'implementar', 'create', 'crear', 'build', 'construir'];
    const lowCog = ['what', 'qué', 'define', 'list', 'listar', 'show', 'mostrar'];

    highCog.forEach(w => { if (lower.includes(w)) score += 2; });
    medCog.forEach(w => { if (lower.includes(w)) score += 1; });
    lowCog.forEach(w => { if (lower.includes(w)) score -= 0.5; });

    return Math.max(1, Math.min(10, Math.round(score)));
  }

  private analyzeDomainBreadth(prompt: string): number {
    const lower = prompt.toLowerCase();
    const domains = ['database', 'base de datos', 'frontend', 'backend', 'security', 'seguridad', 'api', 'auth', 'autenticación', 'ui', 'ux', 'testing', 'deploy', 'devops', 'cache', 'redis', 'kubernetes', 'docker', 'microservice', 'gateway', 'load balancer'];
    let count = 0;
    domains.forEach(d => { if (lower.includes(d)) count++; });
    return Math.min(10, 1 + count * 2);
  }

  private analyzeStepsRequired(prompt: string): number {
    const lower = prompt.toLowerCase();
    const stepIndicators = ['then', 'después', 'luego', 'next', 'step', 'paso', 'first', 'primero', 'finally', 'finalmente', 'and then', 'y luego', 'after', 'después de'];
    let count = 0;
    stepIndicators.forEach(w => { if (lower.includes(w)) count++; });
    
    const conjunctions = (lower.match(/,|\by\b|\band\b/g) || []).length;
    count += Math.floor(conjunctions / 2);

    return Math.min(10, 1 + count);
  }

  private analyzeAmbiguity(prompt: string): number {
    const wordCount = prompt.split(/\s+/).length;
    if (wordCount < 3) return 2;
    if (wordCount < 6) return 5;
    if (wordCount < 10) return 3;
    return 2;
  }

  private analyzeTechnicalDepth(prompt: string): number {
    const lower = prompt.toLowerCase();
    const techTerms = ['algorithm', 'algoritmo', 'database', 'api', 'jwt', 'oauth', 'websocket', 'redis', 'sql', 'nosql', 'microservice', 'kubernetes', 'docker', 'cache', 'index', 'transaction', 'migration', 'arquitectura', 'sharding', 'replication', 'load balancer', 'cdn', 'ssl', 'https'];
    let score = 1;
    techTerms.forEach(t => { if (lower.includes(t)) score += 1.5; });
    return Math.min(10, Math.round(score));
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

  private detectSignals(prompt: string, dimensions: ComplexityResult['dimensions'], score: number): string[] {
    const signals: string[] = [];
    if (score >= 9) signals.push('architectural_scope');
    if (dimensions.cognitive_load >= 7) signals.push('high_reasoning_required');
    if (dimensions.domain_breadth >= 5) signals.push('multi_domain');
    if (dimensions.steps_required >= 5) signals.push('multi_step_task');
    if (dimensions.ambiguity_level >= 6) signals.push('needs_clarification');
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
