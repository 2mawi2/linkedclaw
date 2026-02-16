/**
 * Category & skill suggestion engine.
 *
 * Given a free-text listing description, suggests the most relevant
 * categories and skills from a curated taxonomy. Uses keyword matching
 * with weighted scoring - no external API calls needed.
 */

export interface CategorySuggestion {
  category: string;
  confidence: number; // 0-1
  label: string;
}

export interface SkillSuggestion {
  skill: string;
  confidence: number; // 0-1
  matched_term: string; // the keyword that triggered this suggestion
}

export interface SuggestionResult {
  categories: CategorySuggestion[];
  skills: SkillSuggestion[];
}

/** Category definitions with keywords and display labels */
const CATEGORY_TAXONOMY: {
  category: string;
  label: string;
  keywords: string[];
  weight: number;
}[] = [
  {
    category: "freelance-dev",
    label: "Freelance Development",
    keywords: [
      "developer",
      "development",
      "programming",
      "coding",
      "software",
      "engineer",
      "full-stack",
      "fullstack",
      "frontend",
      "backend",
      "web app",
      "webapp",
      "website",
      "api",
      "saas",
      "mvp",
      "prototype",
      "codebase",
      "repository",
      "code review",
    ],
    weight: 1.0,
  },
  {
    category: "devops",
    label: "DevOps & Infrastructure",
    keywords: [
      "devops",
      "infrastructure",
      "deployment",
      "deploy",
      "ci/cd",
      "pipeline",
      "docker",
      "kubernetes",
      "k8s",
      "terraform",
      "ansible",
      "cloud",
      "aws",
      "gcp",
      "azure",
      "monitoring",
      "alerting",
      "scaling",
      "server",
      "linux",
      "nginx",
      "ssl",
    ],
    weight: 1.0,
  },
  {
    category: "content-writing",
    label: "Content & Technical Writing",
    keywords: [
      "writing",
      "writer",
      "content",
      "documentation",
      "docs",
      "technical writing",
      "blog",
      "article",
      "tutorial",
      "copywriting",
      "copy",
      "readme",
      "seo content",
      "ghostwriting",
    ],
    weight: 1.0,
  },
  {
    category: "data-processing",
    label: "Data & Analytics",
    keywords: [
      "data",
      "analytics",
      "etl",
      "pipeline",
      "database",
      "sql",
      "visualization",
      "dashboard",
      "reporting",
      "scraping",
      "crawling",
      "cleaning",
      "pandas",
      "jupyter",
      "notebook",
      "dataset",
      "csv",
      "spreadsheet",
    ],
    weight: 1.0,
  },
  {
    category: "consulting",
    label: "Consulting & Advisory",
    keywords: [
      "consulting",
      "consultant",
      "advisory",
      "audit",
      "security",
      "penetration",
      "pentest",
      "compliance",
      "owasp",
      "review",
      "assessment",
      "strategy",
      "architecture review",
    ],
    weight: 1.0,
  },
  {
    category: "design",
    label: "Design & UI/UX",
    keywords: [
      "design",
      "designer",
      "ui",
      "ux",
      "user interface",
      "user experience",
      "figma",
      "sketch",
      "wireframe",
      "mockup",
      "prototype",
      "branding",
      "logo",
      "graphic",
      "illustration",
      "visual",
      "layout",
      "responsive",
    ],
    weight: 1.0,
  },
  {
    category: "ai-ml",
    label: "AI & Machine Learning",
    keywords: [
      "ai",
      "artificial intelligence",
      "machine learning",
      "ml",
      "deep learning",
      "neural",
      "nlp",
      "natural language",
      "llm",
      "gpt",
      "transformer",
      "model training",
      "fine-tuning",
      "computer vision",
      "classification",
      "embedding",
      "rag",
      "chatbot",
      "prompt engineering",
    ],
    weight: 1.0,
  },
  {
    category: "mobile-dev",
    label: "Mobile Development",
    keywords: [
      "mobile",
      "ios",
      "android",
      "react native",
      "flutter",
      "swift",
      "kotlin",
      "app store",
      "play store",
      "native app",
      "mobile app",
    ],
    weight: 1.0,
  },
  {
    category: "testing-qa",
    label: "Testing & QA",
    keywords: [
      "testing",
      "qa",
      "quality assurance",
      "test automation",
      "selenium",
      "playwright",
      "cypress",
      "unit test",
      "integration test",
      "e2e",
      "end-to-end",
      "regression",
      "bug",
      "load testing",
    ],
    weight: 1.0,
  },
  {
    category: "blockchain",
    label: "Blockchain & Web3",
    keywords: [
      "blockchain",
      "web3",
      "smart contract",
      "solidity",
      "ethereum",
      "defi",
      "nft",
      "token",
      "crypto",
      "wallet",
      "dapp",
    ],
    weight: 1.0,
  },
];

/** Skill keywords mapped to canonical skill names */
const SKILL_TAXONOMY: { skill: string; keywords: string[] }[] = [
  { skill: "TypeScript", keywords: ["typescript", "ts"] },
  { skill: "JavaScript", keywords: ["javascript", "js", "ecmascript"] },
  { skill: "React", keywords: ["react", "reactjs", "react.js"] },
  { skill: "Next.js", keywords: ["next.js", "nextjs", "next js"] },
  { skill: "Node.js", keywords: ["node.js", "nodejs", "node js"] },
  { skill: "Python", keywords: ["python"] },
  { skill: "Go", keywords: ["golang", " go "] },
  { skill: "Rust", keywords: ["rust", "rustlang"] },
  { skill: "Java", keywords: [" java ", "java,", "java."] },
  { skill: "C#", keywords: ["c#", "csharp", ".net", "dotnet"] },
  { skill: "Ruby", keywords: ["ruby", "rails", "ruby on rails"] },
  { skill: "PHP", keywords: ["php", "laravel", "symfony"] },
  { skill: "SQL", keywords: ["sql", "postgresql", "postgres", "mysql", "sqlite"] },
  { skill: "PostgreSQL", keywords: ["postgresql", "postgres"] },
  { skill: "MongoDB", keywords: ["mongodb", "mongo"] },
  { skill: "Redis", keywords: ["redis"] },
  { skill: "Docker", keywords: ["docker", "container", "dockerfile"] },
  { skill: "Kubernetes", keywords: ["kubernetes", "k8s"] },
  { skill: "AWS", keywords: ["aws", "amazon web services", "s3", "ec2", "lambda"] },
  { skill: "GCP", keywords: ["gcp", "google cloud"] },
  { skill: "Azure", keywords: ["azure"] },
  { skill: "Terraform", keywords: ["terraform"] },
  { skill: "GraphQL", keywords: ["graphql"] },
  { skill: "REST API", keywords: ["rest api", "restful", "rest "] },
  { skill: "Tailwind CSS", keywords: ["tailwind", "tailwindcss"] },
  { skill: "CSS", keywords: ["css", "scss", "sass", "less"] },
  { skill: "HTML", keywords: ["html"] },
  { skill: "Vue.js", keywords: ["vue", "vuejs", "vue.js"] },
  { skill: "Angular", keywords: ["angular"] },
  { skill: "Svelte", keywords: ["svelte", "sveltekit"] },
  { skill: "Flutter", keywords: ["flutter", "dart"] },
  { skill: "React Native", keywords: ["react native"] },
  { skill: "Swift", keywords: ["swift", "swiftui"] },
  { skill: "Kotlin", keywords: ["kotlin"] },
  { skill: "Figma", keywords: ["figma"] },
  { skill: "Git", keywords: ["git", "github", "gitlab"] },
  { skill: "CI/CD", keywords: ["ci/cd", "github actions", "jenkins", "circleci"] },
  { skill: "Technical Writing", keywords: ["technical writing", "documentation", "docs"] },
  { skill: "API Documentation", keywords: ["api docs", "api documentation", "openapi", "swagger"] },
  { skill: "Data Analysis", keywords: ["data analysis", "analytics", "data science"] },
  { skill: "Machine Learning", keywords: ["machine learning", "ml model", "training"] },
  { skill: "NLP", keywords: ["nlp", "natural language processing", "text processing"] },
  { skill: "Pandas", keywords: ["pandas"] },
  { skill: "TensorFlow", keywords: ["tensorflow"] },
  { skill: "PyTorch", keywords: ["pytorch"] },
  { skill: "Solidity", keywords: ["solidity", "smart contract"] },
  { skill: "Selenium", keywords: ["selenium"] },
  { skill: "Playwright", keywords: ["playwright"] },
  { skill: "Linux", keywords: ["linux", "ubuntu", "debian"] },
  { skill: "Prompt Engineering", keywords: ["prompt engineering", "prompt design"] },
];

/**
 * Suggest categories and skills from a free-text description.
 * Returns up to `maxCategories` categories and `maxSkills` skills,
 * sorted by confidence (descending).
 */
export function suggestFromDescription(
  description: string,
  maxCategories = 3,
  maxSkills = 8,
): SuggestionResult {
  if (!description || description.trim().length === 0) {
    return { categories: [], skills: [] };
  }

  const text = ` ${description.toLowerCase()} `;

  // Score categories
  const categoryScores: CategorySuggestion[] = [];
  for (const cat of CATEGORY_TAXONOMY) {
    let matchCount = 0;
    for (const kw of cat.keywords) {
      if (text.includes(kw)) {
        matchCount++;
      }
    }
    if (matchCount > 0) {
      // Confidence: ratio of matched keywords, capped at 1.0
      const confidence = Math.min(
        1.0,
        (matchCount / Math.min(cat.keywords.length, 5)) * cat.weight,
      );
      categoryScores.push({
        category: cat.category,
        confidence: Math.round(confidence * 100) / 100,
        label: cat.label,
      });
    }
  }
  categoryScores.sort((a, b) => b.confidence - a.confidence);

  // Score skills
  const skillScores: SkillSuggestion[] = [];
  for (const sk of SKILL_TAXONOMY) {
    for (const kw of sk.keywords) {
      if (text.includes(kw)) {
        skillScores.push({
          skill: sk.skill,
          confidence: 0.9, // keyword match is high confidence
          matched_term: kw.trim(),
        });
        break; // one match per skill is enough
      }
    }
  }
  skillScores.sort((a, b) => b.confidence - a.confidence || a.skill.localeCompare(b.skill));

  return {
    categories: categoryScores.slice(0, maxCategories),
    skills: skillScores.slice(0, maxSkills),
  };
}
