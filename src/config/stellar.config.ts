import { registerAs } from "@nestjs/config";
import { Networks } from "@stellar/stellar-sdk";

export type StellarNetwork = "testnet" | "mainnet";

interface StellarNetworkDefaults {
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
}

const NETWORK_DEFAULTS: Record<StellarNetwork, StellarNetworkDefaults> = {
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    networkPassphrase: Networks.TESTNET,
  },
  mainnet: {
    rpcUrl: "https://soroban-mainnet.stellar.org",
    horizonUrl: "https://horizon.stellar.org",
    networkPassphrase: Networks.PUBLIC,
  },
};

function resolveNetwork(value?: string): StellarNetwork {
  const network = (value ?? "testnet").toLowerCase();

  if (network !== "testnet" && network !== "mainnet") {
    throw new Error(
      `Invalid STELLAR_NETWORK "${value}". Expected "testnet" or "mainnet".`,
    );
  }

  return network;
}

export interface StellarConfig {
  network: StellarNetwork;
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  contractAddress?: string;
}

const TESTNET_URL_PATTERN = /-testnet\.stellar\.org/i;
const LOCAL_URL_PATTERN = /(localhost|127\.0\.0\.1)/i;

/**
 * Fails fast (#498) when the resolved Stellar config claims to be mainnet
 * but is actually pointed at testnet/local infrastructure, uses the wrong
 * network passphrase, or is missing the deployed contract address. This is
 * intentionally conservative: a misconfigured mainnet deployment could
 * otherwise sign/submit transactions against the wrong network or silently
 * no-op against a missing contract.
 */
export function assertMainnetConfigSafe(config: StellarConfig): void {
  if (config.network !== "mainnet") {
    return;
  }

  const problems: string[] = [];

  if (config.networkPassphrase !== Networks.PUBLIC) {
    problems.push(
      `networkPassphrase "${config.networkPassphrase}" does not match the public mainnet passphrase.`,
    );
  }

  if (TESTNET_URL_PATTERN.test(config.horizonUrl)) {
    problems.push(
      `horizonUrl "${config.horizonUrl}" points at a testnet host.`,
    );
  }
  if (LOCAL_URL_PATTERN.test(config.horizonUrl)) {
    problems.push(`horizonUrl "${config.horizonUrl}" points at a local host.`);
  }

  if (TESTNET_URL_PATTERN.test(config.rpcUrl)) {
    problems.push(`rpcUrl "${config.rpcUrl}" points at a testnet host.`);
  }
  if (LOCAL_URL_PATTERN.test(config.rpcUrl)) {
    problems.push(`rpcUrl "${config.rpcUrl}" points at a local host.`);
  }

  if (!config.contractAddress) {
    problems.push(
      "No contract address configured (set SOROBAN_CONTRACT_ADDRESS or HIRESETTLE_CONTRACT_ID).",
    );
  } else if (config.contractAddress.toUpperCase().includes("TEST")) {
    problems.push(
      `contractAddress "${config.contractAddress}" looks like a testnet artifact.`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Unsafe mainnet Stellar configuration detected:\n- ${problems.join("\n- ")}`,
    );
  }
}

export default registerAs("stellar", () => {
  const network = resolveNetwork(process.env.STELLAR_NETWORK);
  const defaults = NETWORK_DEFAULTS[network];

  const config: StellarConfig = {
    network,
    rpcUrl: process.env.STELLAR_RPC_URL ?? defaults.rpcUrl,
    horizonUrl: process.env.STELLAR_HORIZON_URL ?? defaults.horizonUrl,
    networkPassphrase: defaults.networkPassphrase,
    contractAddress:
      process.env.SOROBAN_CONTRACT_ADDRESS ??
      process.env.HIRESETTLE_CONTRACT_ID,
  };

  assertMainnetConfigSafe(config);

  return config;
});
