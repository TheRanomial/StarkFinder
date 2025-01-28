import { readFileSync } from "fs";
import path from "path";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import dotenv from "dotenv";
import { agent } from "./bot";
dotenv.config();

export interface UserPreferences {
  riskTolerance: "low" | "medium" | "high";
  preferredAssets: string[];
  preferredChains: string[];
  investmentHorizon: "short" | "medium" | "long";
  minTVL?: number;
  targetAPY?: number;
}

interface Pool {
  name: string;
  apy: number;
  tvl: number;
  chain: string;
  assets: string[];
  riskLevel: "low" | "medium" | "high";
  impermanentLoss: number;
  protocol: string;
}

export class InvestmentAdvisor {
  private static instance: InvestmentAdvisor;
  private chatModel: ChatOpenAI;
  private pools: Pool[] = [];
  private userPreferences: Map<string, UserPreferences> = new Map();

  constructor() {
    this.chatModel = agent;
    this.loadPoolData();
  }

  public static getInstance(): InvestmentAdvisor {
    if (!InvestmentAdvisor.instance) {
      InvestmentAdvisor.instance = new InvestmentAdvisor();
    }
    return InvestmentAdvisor.instance;
  }

  private loadPoolData(): void {
    try {
      const filePath = path.join(__dirname, "data", "tokens.json");
      console.log("Loading pool data from:", filePath);

      const rawData = readFileSync(filePath, "utf-8");
      const parsedData = JSON.parse(rawData);

      if (!Array.isArray(parsedData)) {
        console.error("Loaded pool data is not an array");
        this.pools = [];
        return;
      }

      this.pools = parsedData.filter((pool): pool is Pool => {
        return (
          typeof pool === "object" &&
          pool !== null &&
          typeof pool.name === "string" &&
          typeof pool.apy === "number" &&
          typeof pool.tvl === "number" &&
          typeof pool.chain === "string" &&
          Array.isArray(pool.assets) &&
          typeof pool.riskLevel === "string" &&
          typeof pool.impermanentLoss === "number" &&
          typeof pool.protocol === "string"
        );
      });

      console.log(`Successfully loaded ${this.pools.length} pools`);
    } catch (error) {
      console.error("Error loading pool data:", error);
      this.pools = [];
    }
  }

  private ensureValidPools(): void {
    if (!Array.isArray(this.pools)) {
      console.error("Pools is not an array, resetting to empty array");
      this.pools = [];
    }
  }

  async setUserPreferences(userId: string, message: string): Promise<string> {
    try {
      const response = await this.chatModel.invoke([
        new SystemMessage(
          `Extract investment preferences from user message. Return JSON with format:
                {
                  "riskTolerance": "low|medium|high",
                  "preferredAssets": ["asset1", "asset2"],
                  "preferredChains": ["chain1", "chain2"],
                  "investmentHorizon": "short|medium|long",
                  "minTVL": number,
                  "targetAPY": number
                }`
        ),
        new HumanMessage(message),
      ]);

      const preferences = JSON.parse(response.content as string);
      this.userPreferences.set(userId, preferences);

      return "✅ I've updated your investment preferences. Would you like to see some recommendations based on these preferences?";
    } catch (error) {
      console.error("Error setting user preferences:", error);
      return "❌ I couldn't process your preferences. Please try again with clearer specifications.";
    }
  }

  private calculateRiskScore(pool: Pool, preferences: UserPreferences): number {
    let score = 0;
    if (pool.apy > 50) score += 3;
    else if (pool.apy > 20) score += 2;
    else score += 1;
    if (pool.tvl > 1000000) score -= 1;
    if (pool.tvl > 10000000) score -= 1;

    if (
      preferences.preferredAssets.some((asset) => pool.assets.includes(asset))
    ) {
      score -= 1;
    }
    score += Math.floor(pool.impermanentLoss / 10);

    return score;
  }

  private filterPoolsByPreferences(preferences: UserPreferences): Pool[] {
    return this.pools.filter((pool) => {
      const chainMatch = preferences.preferredChains.includes(pool.chain);
      const tvlMatch = !preferences.minTVL || pool.tvl >= preferences.minTVL;
      const apyMatch =
        !preferences.targetAPY || pool.apy >= preferences.targetAPY;

      const riskScore = this.calculateRiskScore(pool, preferences);
      const riskMatch =
        (preferences.riskTolerance === "low" && riskScore <= 2) ||
        (preferences.riskTolerance === "medium" && riskScore <= 4) ||
        preferences.riskTolerance === "high";

      return chainMatch && tvlMatch && apyMatch && riskMatch;
    });
  }

  public getUserPreferences(userId: string): UserPreferences | undefined {
    return this.userPreferences.get(userId);
  }

  async getRecommendations(userId: string): Promise<string> {
    const preferences = this.userPreferences.get(userId);
    if (!preferences) {
      return "❌ Please set your investment preferences first using /setpreferences.";
    }

    try {
      this.ensureValidPools();

      if (this.pools.length === 0) {
        return "❌ No pool data available. Please try again later.";
      }

      const filteredPools = this.filterPoolsByPreferences(preferences);

      if (filteredPools.length === 0) {
        return "❌ No pools found matching your preferences. Try adjusting your criteria.";
      }

      const response = await this.chatModel.invoke([
        new SystemMessage(
          "Generate personalized investment recommendations based on the user's preferences and filtered pools. Include pros and cons for each recommendation."
        ),
        new HumanMessage(
          JSON.stringify({
            preferences,
            recommendations: filteredPools,
          })
        ),
      ]);

      return response.content as string;
    } catch (error) {
      console.error("Error generating recommendations:", error);
      return "❌ Error generating recommendations. Please try again later.";
    }
  }
}
