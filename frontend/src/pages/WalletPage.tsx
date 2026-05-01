import { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider, formatEther } from "ethers";
import { challengeAbi } from "../abi";
import "../index.css";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    };
  }
}

type WalletPageProps = {
  onNavigate: (path: string) => void;
};

type PendingPenalty = {
  challengeId: number;
  periodIndex: number;
  amountRaw: bigint;
  amountFormatted: string;
  reason: string;
};

const RPC_URL = import.meta.env.VITE_RPC_URL as string;
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as string;
const CONFIGURED_CHALLENGE_ID = Number(import.meta.env.VITE_CHALLENGE_ID ?? "0");
const USER_ADDRESS = String(import.meta.env.VITE_USER_ADDRESS ?? "").toLowerCase();
const HARDHAT_CHAIN_ID_HEX = "0x7a69";
const METAMASK_LOCALHOST_CHAIN_ID_HEX = "0x539";

function formatChainName(chainIdHex: string): string {
  if (chainIdHex === HARDHAT_CHAIN_ID_HEX) return "Hardhat Local";
  if (chainIdHex === METAMASK_LOCALHOST_CHAIN_ID_HEX) return "Localhost 8545 (1337)";
  return "Unknown network";
}

function normalizeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return fallback;
}

export default function WalletPage({ onNavigate }: WalletPageProps) {
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState("");
  const [chainIdHex, setChainIdHex] = useState("");
  const [networkName, setNetworkName] = useState("");
  const [status, setStatus] = useState("Wallet is not connected.");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [penaltyRecipient, setPenaltyRecipient] = useState("");
  const [treasuryAddress, setTreasuryAddress] = useState("");
  const [treasuryBalance, setTreasuryBalance] = useState("0");
  const [pendingPenalties, setPendingPenalties] = useState<PendingPenalty[]>([]);
  const [outstandingPenalty, setOutstandingPenalty] = useState("0");
  const [activeChallengeId, setActiveChallengeId] = useState(0);
  const [busy, setBusy] = useState(false);

  async function loadPenaltyData() {
    try {
      const provider = new JsonRpcProvider(RPC_URL);
      const code = await provider.getCode(CONTRACT_ADDRESS);

      if (!code || code === "0x") {
        setPenaltyRecipient("");
        setTreasuryAddress("");
        setTreasuryBalance("0");
        setOutstandingPenalty("0");
        setPendingPenalties([]);
        setActiveChallengeId(0);
        return;
      }

      const contract = new Contract(CONTRACT_ADDRESS, challengeAbi, provider);
      const recipient = String(await contract.penaltyRecipient());
      const treasury = String(await contract.treasury());
      const rawTreasuryBalance = await contract.treasuryBalance();
      const nextChallengeId = Number(await contract.nextChallengeId());
      let trackedUserAddress = USER_ADDRESS;

      if (!trackedUserAddress && CONFIGURED_CHALLENGE_ID > 0) {
        const configuredChallenge = await contract.getChallenge(CONFIGURED_CHALLENGE_ID);
        trackedUserAddress = String(configuredChallenge[0]).toLowerCase();
      }

      let currentActiveChallengeId = 0;
      let formattedOutstandingPenalty = "—";

      if (trackedUserAddress) {
        const rawOutstandingPenalty = await contract.outstandingPenaltyOf(trackedUserAddress);
        currentActiveChallengeId = Number(await contract.activeChallengeOf(trackedUserAddress));
        formattedOutstandingPenalty = formatEther(rawOutstandingPenalty);
      }

      const nextPending: PendingPenalty[] = [];
      for (let challengeId = 1; challengeId < nextChallengeId; challengeId++) {
        const challenge = await contract.getChallenge(challengeId);
        if (trackedUserAddress && String(challenge[0]).toLowerCase() !== trackedUserAddress) {
          continue;
        }

        const totalPeriods = Number(challenge[5]);
        for (let index = 0; index < totalPeriods; index++) {
          const record = await contract.getPeriodRecord(challengeId, index);
          const statusCode = Number(record[0]);
          const amountRaw = BigInt(record[2]);
          const penaltySettled = Boolean(record[3]);

          if ((statusCode === 2 || statusCode === 3) && amountRaw > 0n && !penaltySettled) {
            nextPending.push({
              challengeId,
              periodIndex: index,
              amountRaw,
              amountFormatted: formatEther(amountRaw),
              reason: statusCode === 2 ? "No submissions" : "No accepted OK",
            });
          }
        }
      }

      setPenaltyRecipient(recipient);
      setTreasuryAddress(treasury);
      setTreasuryBalance(formatEther(rawTreasuryBalance));
      setOutstandingPenalty(formattedOutstandingPenalty);
      setPendingPenalties(nextPending);
      setActiveChallengeId(currentActiveChallengeId);
    } catch (contractError) {
      console.error(contractError);
      setPenaltyRecipient("");
      setTreasuryAddress("");
      setTreasuryBalance("0");
      setOutstandingPenalty("0");
      setPendingPenalties([]);
      setActiveChallengeId(0);
    }
  }

  async function refreshWalletState() {
    if (!window.ethereum) {
      setError("MetaMask was not found.");
      setStatus("MetaMask is not installed.");
      return;
    }

    try {
      const provider = new BrowserProvider(window.ethereum);
      const accounts = (await window.ethereum.request({
        method: "eth_accounts",
      })) as string[];

      const chain = (await window.ethereum.request({
        method: "eth_chainId",
      })) as string;

      setChainIdHex(chain);
      setNetworkName(formatChainName(chain));

      if (!accounts.length) {
        setAccount("");
        setBalance("");
        setStatus("Wallet found, but account access has not been granted yet.");
        await loadPenaltyData();
        return;
      }

      const walletAccount = accounts[0];
      const walletBalance = await provider.getBalance(walletAccount);

      setAccount(walletAccount);
      setBalance(formatEther(walletBalance));
      setStatus("MetaMask connected.");
      await loadPenaltyData();
    } catch (walletError) {
      console.error(walletError);
      setError(normalizeError(walletError, "Failed to read wallet state."));
      setStatus("Could not read MetaMask data.");
    }
  }

  async function autoConnectWallet() {
    if (!window.ethereum) {
      setStatus("MetaMask is not installed.");
      return;
    }

    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await refreshWalletState();
    } catch (connectError) {
      console.error(connectError);
      setStatus("Auto-connect to MetaMask was rejected or failed.");
    }
  }

  async function payPenalty(challengeId: number, periodIndex: number, amount: bigint) {
    if (!window.ethereum) {
      setError("MetaMask was not found.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, challengeAbi, signer);
      const tx = await contract.payPeriodPenalty(challengeId, periodIndex, {
        value: amount,
      });

      setNotice("Penalty transaction sent. Confirm it in MetaMask.");
      await tx.wait();
      setNotice(`Penalty for challenge #${challengeId}, period ${periodIndex + 1}, was paid.`);
      await refreshWalletState();
    } catch (payError) {
      console.error(payError);
      setError(normalizeError(payError, "Failed to pay the penalty."));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadPenaltyData();
    void refreshWalletState();
    void autoConnectWallet();

    if (!window.ethereum?.on) return;

    const handleAccountsChanged = () => {
      void refreshWalletState();
    };

    const handleChainChanged = () => {
      void refreshWalletState();
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  const hardhatStatus = useMemo(() => {
    if (!chainIdHex) {
      return {
        kind: "warn",
        text: "Network is not detected yet. Connect MetaMask and check chainId.",
      };
    }

    if (chainIdHex === HARDHAT_CHAIN_ID_HEX) {
      return {
        kind: "ok",
        text: "Connected to local Hardhat network with chainId 31337.",
      };
    }

    if (chainIdHex === METAMASK_LOCALHOST_CHAIN_ID_HEX) {
      return {
        kind: "warn",
        text: "MetaMask is on localhost with chainId 1337. Hardhat usually runs on 31337.",
      };
    }

    return {
      kind: "error",
      text: `Wrong network selected. Current chainId is ${chainIdHex}, but Hardhat Local usually uses ${HARDHAT_CHAIN_ID_HEX}.`,
    };
  }, [chainIdHex]);

  const accountRoleText = useMemo(() => {
    if (!account) {
      return "Wallet is not connected.";
    }

    if (USER_ADDRESS && account.toLowerCase() === USER_ADDRESS) {
      return "This is the main user account. You can pay accumulated penalties from it.";
    }

    if (!USER_ADDRESS) {
      return "VITE_USER_ADDRESS is not set, so the page is running in compatibility mode.";
    }

    return "A different account is connected. It is better to use the same address that created the challenge.";
  }, [account]);

  return (
    <div className="page">
      <div className="container wallet-container">
        <div className="hero">
          <div>
            <h1>Dev Wallet</h1>
            <p>MetaMask screen for penalty payments and accumulated debt.</p>
          </div>
          <div className="hero-actions">
            <button className="refresh" onClick={() => onNavigate("/")}>
              Back
            </button>
          </div>
        </div>

        {error ? <div className="wallet-banner wallet-banner-error">{error}</div> : null}
        {notice ? <div className="wallet-banner wallet-banner-ok">{notice}</div> : null}

        <div className="wallet-grid">
          <div className="wallet-card">
            <h2>Status</h2>
            <div className="wallet-list">
              <div className="wallet-row">
                <span>Connection</span>
                <strong>{status}</strong>
              </div>
              <div className="wallet-row">
                <span>Address</span>
                <strong className="wallet-mono">{account || "Not connected"}</strong>
              </div>
              <div className="wallet-row">
                <span>Network</span>
                <strong>{networkName || "Unknown"}</strong>
              </div>
              <div className="wallet-row">
                <span>chainId</span>
                <strong>{chainIdHex || "-"}</strong>
              </div>
              <div className="wallet-row">
                <span>Balance</span>
                <strong>{balance ? `${balance} ETH` : "-"}</strong>
              </div>
            </div>
          </div>
        </div>

        <div
          className={`wallet-banner ${
            hardhatStatus.kind === "ok"
              ? "wallet-banner-ok"
              : hardhatStatus.kind === "warn"
                ? "wallet-banner-warn"
                : "wallet-banner-error"
          }`}
        >
          {hardhatStatus.text}
        </div>

        <div className="wallet-grid">
          <div className="wallet-card">
            <h2>Penalty State</h2>
            <div className="wallet-list">
              <div className="wallet-row">
                <span>Main account</span>
                <strong className="wallet-mono">{USER_ADDRESS || "Not set"}</strong>
              </div>
              <div className="wallet-row">
                <span>Penalty recipient</span>
                <strong className="wallet-mono">{penaltyRecipient || "-"}</strong>
              </div>
              <div className="wallet-row">
                <span>Treasury</span>
                <strong className="wallet-mono">{treasuryAddress || "-"}</strong>
              </div>
              <div className="wallet-row">
                <span>Collected penalties</span>
                <strong>{treasuryBalance} ETH</strong>
              </div>
              <div className="wallet-row">
                <span>Outstanding debt</span>
                <strong>{outstandingPenalty} ETH</strong>
              </div>
              <div className="wallet-row">
                <span>Active challenge</span>
                <strong>{activeChallengeId > 0 ? `#${activeChallengeId}` : "none"}</strong>
              </div>
              <div className="wallet-row">
                <span>Current connected account</span>
                <strong>{accountRoleText}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="wallet-grid">
          <div className="wallet-card">
            <h2>Open Penalties</h2>
            {pendingPenalties.length === 0 ? (
              <p className="wallet-text">
                There are currently no penalties waiting for separate payment through MetaMask.
              </p>
            ) : (
              <div className="wallet-list">
                {pendingPenalties.map((penalty) => (
                  <div
                    className="wallet-penalty-card"
                    key={`${penalty.challengeId}-${penalty.periodIndex}`}
                  >
                    <div className="wallet-row">
                      <span>Challenge</span>
                      <strong>#{penalty.challengeId}</strong>
                    </div>
                    <div className="wallet-row">
                      <span>Period</span>
                      <strong>{penalty.periodIndex + 1}</strong>
                    </div>
                    <div className="wallet-row">
                      <span>Reason</span>
                      <strong>{penalty.reason}</strong>
                    </div>
                    <div className="wallet-row">
                      <span>Penalty amount</span>
                      <strong>{penalty.amountFormatted} ETH</strong>
                    </div>
                    <div className="wallet-actions">
                      <button
                        className="refresh"
                        onClick={() =>
                          void payPenalty(
                            penalty.challengeId,
                            penalty.periodIndex,
                            penalty.amountRaw
                          )
                        }
                        disabled={busy}
                      >
                        Pay Penalty
                      </button>
                    </div>
                    <p className="wallet-help">
                      You can pay a penalty even after an older challenge has ended. It stays in debt
                      until it is settled.
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
