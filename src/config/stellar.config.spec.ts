import stellarConfig, {
  assertMainnetConfigSafe,
  StellarConfig,
} from "./stellar.config";
import { Networks } from "@stellar/stellar-sdk";

describe("stellarConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.STELLAR_NETWORK;
    delete process.env.STELLAR_RPC_URL;
    delete process.env.STELLAR_HORIZON_URL;
    delete process.env.SOROBAN_CONTRACT_ADDRESS;
    delete process.env.HIRESETTLE_CONTRACT_ID;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("defaults to testnet network settings", () => {
    expect(stellarConfig()).toMatchObject({
      network: "testnet",
      rpcUrl: "https://soroban-testnet.stellar.org",
      horizonUrl: "https://horizon-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
  });

  it("uses mainnet network settings when STELLAR_NETWORK=mainnet", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    process.env.SOROBAN_CONTRACT_ADDRESS = "CLIVECONTRACTADDRESS";

    expect(stellarConfig()).toMatchObject({
      network: "mainnet",
      rpcUrl: "https://soroban-mainnet.stellar.org",
      horizonUrl: "https://horizon.stellar.org",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });
  });

  it("rejects unsupported STELLAR_NETWORK values", () => {
    process.env.STELLAR_NETWORK = "futurenet";

    expect(() => stellarConfig()).toThrow(
      'Invalid STELLAR_NETWORK "futurenet"',
    );
  });

  it("prefers SOROBAN_CONTRACT_ADDRESS over the legacy contract id variable", () => {
    process.env.SOROBAN_CONTRACT_ADDRESS = "CNEW";
    process.env.HIRESETTLE_CONTRACT_ID = "COLD";

    expect(stellarConfig()).toMatchObject({
      contractAddress: "CNEW",
    });
  });

  it("keeps legacy HIRESETTLE_CONTRACT_ID as a fallback", () => {
    process.env.HIRESETTLE_CONTRACT_ID = "COLD";

    expect(stellarConfig()).toMatchObject({
      contractAddress: "COLD",
    });
  });
});

describe("assertMainnetConfigSafe", () => {
  const validMainnetConfig: StellarConfig = {
    network: "mainnet",
    rpcUrl: "https://soroban-mainnet.stellar.org",
    horizonUrl: "https://horizon.stellar.org",
    networkPassphrase: Networks.PUBLIC,
    contractAddress: "CCONTRACTADDRESS",
  };

  it("passes for a consistent mainnet config", () => {
    expect(() => assertMainnetConfigSafe(validMainnetConfig)).not.toThrow();
  });

  it("is a no-op for testnet configs", () => {
    expect(() =>
      assertMainnetConfigSafe({
        ...validMainnetConfig,
        network: "testnet",
        networkPassphrase: Networks.TESTNET,
      }),
    ).not.toThrow();
  });

  it("throws when the network passphrase is not the public passphrase", () => {
    expect(() =>
      assertMainnetConfigSafe({
        ...validMainnetConfig,
        networkPassphrase: Networks.TESTNET,
      }),
    ).toThrow(/networkPassphrase/);
  });

  it("throws when horizonUrl points at a testnet host", () => {
    expect(() =>
      assertMainnetConfigSafe({
        ...validMainnetConfig,
        horizonUrl: "https://horizon-testnet.stellar.org",
      }),
    ).toThrow(/testnet host/);
  });

  it("throws when rpcUrl points at localhost", () => {
    expect(() =>
      assertMainnetConfigSafe({
        ...validMainnetConfig,
        rpcUrl: "http://localhost:8000",
      }),
    ).toThrow(/local host/);
  });

  it("throws when horizonUrl points at 127.0.0.1", () => {
    expect(() =>
      assertMainnetConfigSafe({
        ...validMainnetConfig,
        horizonUrl: "http://127.0.0.1:8000",
      }),
    ).toThrow(/local host/);
  });

  it("throws when contractAddress is missing", () => {
    expect(() =>
      assertMainnetConfigSafe({
        ...validMainnetConfig,
        contractAddress: undefined,
      }),
    ).toThrow(/No contract address/);
  });

  it("throws when contractAddress looks like a testnet artifact", () => {
    expect(() =>
      assertMainnetConfigSafe({
        ...validMainnetConfig,
        contractAddress: "CTESTCONTRACT",
      }),
    ).toThrow(/testnet artifact/);
  });
});
