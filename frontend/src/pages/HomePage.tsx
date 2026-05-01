import { useEffect, useMemo, useState } from "react";
import { Contract, JsonRpcProvider, formatEther } from "ethers";
import { challengeAbi } from "../abi";
import "../index.css";

type UiPeriodStatus =
  | "unresolved"
  | "completed"
  | "slashed_no_submission"
  | "slashed_no_ok";

type ChallengeData = {
  id: number;
  user: string;
  handle: string;
  startAt: number;
  periodDuration: number;
  cycleDuration: number;
  totalPeriods: number;
  minRating: number;
  penaltyNoSubmission: string;
  penaltyNoOk: string;
  deposit: string;
  slashedAmount: string;
  resolvedPeriods: number;
  withdrawn: boolean;
  canceled: boolean;
  active: boolean;
};

type PeriodData = {
  index: number;
  status: UiPeriodStatus;
  resolvedAt: number;
  penaltyApplied: string;
  penaltySettled: boolean;
  submissionId: string;
  acceptedAt: number;
  rating: string;
  proofHash: string;
};

type HomePageProps = {
  onNavigate: (path: string) => void;
};

const RPC_URL = import.meta.env.VITE_RPC_URL as string;
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as string;
const CONFIGURED_CHALLENGE_ID = Number(import.meta.env.VITE_CHALLENGE_ID ?? "0");
const USER_ADDRESS = String(import.meta.env.VITE_USER_ADDRESS ?? "").toLowerCase();
const EMPTY_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

function mapStatus(status: number): UiPeriodStatus {
  if (status === 1) return "completed";
  if (status === 2) return "slashed_no_submission";
  if (status === 3) return "slashed_no_ok";
  return "unresolved";
}

function statusText(status: UiPeriodStatus): string {
  switch (status) {
    case "completed":
      return "Выполнен";
    case "slashed_no_submission":
      return "Штраф: нет отправок";
    case "slashed_no_ok":
      return "Штраф: нет подходящего OK";
    default:
      return "Ожидает проверки";
  }
}

function formatTs(ts: number): string {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleString();
}

function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export default function HomePage({ onNavigate }: HomePageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nowTs, setNowTs] = useState(Math.floor(Date.now() / 1000));
  const [challenge, setChallenge] = useState<ChallengeData | null>(null);
  const [periods, setPeriods] = useState<PeriodData[]>([]);
  const [outstandingPenalty, setOutstandingPenalty] = useState("0");

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTs(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  async function loadData() {
    try {
      setError("");

      const provider = new JsonRpcProvider(RPC_URL);
      const contract = new Contract(CONTRACT_ADDRESS, challengeAbi, provider);

      let selectedChallengeId = CONFIGURED_CHALLENGE_ID;

      if (USER_ADDRESS) {
        const activeChallengeId = Number(await contract.activeChallengeOf(USER_ADDRESS));
        const nextChallengeId = Number(await contract.nextChallengeId());
        selectedChallengeId =
          activeChallengeId > 0 ? activeChallengeId : Math.max(0, nextChallengeId - 1);
        setOutstandingPenalty(formatEther(await contract.outstandingPenaltyOf(USER_ADDRESS)));
      } else {
        setOutstandingPenalty("—");
      }

      if (selectedChallengeId === 0) {
        setChallenge(null);
        setPeriods([]);
        return;
      }

      const rawChallenge = await contract.getChallenge(selectedChallengeId);

      const challengeData: ChallengeData = {
        id: selectedChallengeId,
        user: String(rawChallenge[0]),
        handle: String(rawChallenge[1]),
        startAt: Number(rawChallenge[2]),
        periodDuration: Number(rawChallenge[3]),
        cycleDuration: Number(rawChallenge[4]),
        totalPeriods: Number(rawChallenge[5]),
        minRating: Number(rawChallenge[6]),
        penaltyNoSubmission: formatEther(rawChallenge[7]),
        penaltyNoOk: formatEther(rawChallenge[8]),
        deposit: formatEther(rawChallenge[9]),
        slashedAmount: formatEther(rawChallenge[10]),
        resolvedPeriods: Number(rawChallenge[11]),
        withdrawn: Boolean(rawChallenge[12]),
        canceled: Boolean(rawChallenge[13]),
        active: Boolean(rawChallenge[14]),
      };

      const loadedPeriods: PeriodData[] = await Promise.all(
        Array.from({ length: challengeData.totalPeriods }, async (_, index) => {
          const rawPeriod = await contract.getPeriodRecord(selectedChallengeId, index);
          return {
            index,
            status: mapStatus(Number(rawPeriod[0])),
            resolvedAt: Number(rawPeriod[1]),
            penaltyApplied: formatEther(rawPeriod[2]),
            penaltySettled: Boolean(rawPeriod[3]),
            submissionId: rawPeriod[4].toString(),
            acceptedAt: Number(rawPeriod[5]),
            rating: rawPeriod[6].toString(),
            proofHash: String(rawPeriod[7]),
          };
        })
      );

      setChallenge(challengeData);
      setPeriods(loadedPeriods);
    } catch (loadError) {
      console.error(loadError);
      setError(
        "Не удалось прочитать данные из контракта. Проверь, что запущен локальный RPC и в frontend/.env.local указаны правильные адреса."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();

    const timer = setInterval(() => {
      void loadData();
    }, 5000);

    return () => clearInterval(timer);
  }, []);

  const currentPeriodIndex = useMemo(() => {
    if (!challenge) return -1;
    if (nowTs < challenge.startAt) return -1;

    const diff = nowTs - challenge.startAt;
    const index = Math.floor(diff / challenge.cycleDuration);

    if (index >= challenge.totalPeriods) {
      return challenge.totalPeriods;
    }

    return index;
  }, [challenge, nowTs]);

  const challengeEnd = useMemo(() => {
    if (!challenge) return 0;
    return (
      challenge.startAt +
      challenge.cycleDuration * (challenge.totalPeriods - 1) +
      challenge.periodDuration
    );
  }, [challenge]);

  const isActiveWindow = useMemo(() => {
    if (!challenge) return false;
    if (currentPeriodIndex < 0 || currentPeriodIndex >= challenge.totalPeriods) return false;

    const currentPeriodStart =
      challenge.startAt + currentPeriodIndex * challenge.cycleDuration;
    return nowTs < currentPeriodStart + challenge.periodDuration;
  }, [challenge, currentPeriodIndex, nowTs]);

  const timeToStart = challenge ? Math.max(0, challenge.startAt - nowTs) : 0;
  const timeToEnd = challenge ? Math.max(0, challengeEnd - nowTs) : 0;
  const refundableDeposit =
    challenge && !challenge.withdrawn && !challenge.canceled ? challenge.deposit : "0";

  if (loading) {
    return (
      <div className="page">
        <div className="box">Загрузка данных из контракта...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="box error">{error}</div>
      </div>
    );
  }

  if (!challenge) {
    return (
      <div className="page">
        <div className="box error">Для этого пользователя еще не создано ни одного challenge.</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <div className="hero">
          <div>
            <h1>Codeforces Daily Challenge</h1>
            <p>Один длинный challenge с автоматической сменой периодов и накопленным долгом.</p>
          </div>
          <div className="hero-actions">
            <button className="refresh" onClick={() => void loadData()}>
              Обновить
            </button>
            <button className="ghost-link" onClick={() => onNavigate("/wallet")}>
              Dev Wallet
            </button>
          </div>
        </div>

        <div className="grid stats">
          <div className="card">
            <div className="label">Challenge ID</div>
            <div className="value">#{challenge.id}</div>
          </div>
          <div className="card">
            <div className="label">Handle</div>
            <div className="value">{challenge.handle}</div>
          </div>
          <div className="card">
            <div className="label">Депозит</div>
            <div className="value">{challenge.deposit} ETH</div>
          </div>
          <div className="card">
            <div className="label">Оплачено штрафов в этом challenge</div>
            <div className="value">{challenge.slashedAmount} ETH</div>
          </div>
          <div className="card">
            <div className="label">Накопленный долг</div>
            <div className="value">{outstandingPenalty} ETH</div>
          </div>
          <div className="card">
            <div className="label">К возврату</div>
            <div className="value">{refundableDeposit} ETH</div>
          </div>
        </div>

        <div className="grid timing">
          <div className="card">
            <div className="label">Старт challenge</div>
            <div className="value small">{formatTs(challenge.startAt)}</div>
          </div>
          <div className="card">
            <div className="label">Конец challenge</div>
            <div className="value small">{formatTs(challengeEnd)}</div>
          </div>
          <div className="card">
            <div className="label">До старта</div>
            <div className="value">{formatCountdown(timeToStart)}</div>
          </div>
          <div className="card">
            <div className="label">До завершения</div>
            <div className="value">{formatCountdown(timeToEnd)}</div>
          </div>
          <div className="card">
            <div className="label">Текущий период</div>
            <div className="value">
              {currentPeriodIndex < 0
                ? "еще не начался"
                : currentPeriodIndex >= challenge.totalPeriods
                  ? "все периоды завершены"
                  : isActiveWindow
                    ? `${currentPeriodIndex + 1} из ${challenge.totalPeriods}`
                    : `пауза перед периодом ${currentPeriodIndex + 2}`}
            </div>
          </div>
          <div className="card">
            <div className="label">Шаг между периодами</div>
            <div className="value">{challenge.cycleDuration} сек</div>
          </div>
        </div>

        <h2>Периоды</h2>

        <div className="period-grid">
          {periods.map((period) => {
            const periodStart = challenge.startAt + period.index * challenge.cycleDuration;
            const periodEnd = periodStart + challenge.periodDuration;

            return (
              <div className="period-card" key={period.index}>
                <div className="period-header">
                  <div>
                    <div className="period-title">Период {period.index + 1}</div>
                    <div className="period-time">
                      {formatTs(periodStart)} - {formatTs(periodEnd)}
                    </div>
                  </div>

                  <div className={`badge ${period.status}`}>{statusText(period.status)}</div>
                </div>

                <div className="row">
                  <span>Штраф</span>
                  <strong>{period.penaltyApplied} ETH</strong>
                </div>

                <div className="row">
                  <span>Оплачен</span>
                  <strong>{period.penaltySettled ? "Да" : "Нет"}</strong>
                </div>

                <div className="row">
                  <span>Submission ID</span>
                  <strong>{period.submissionId === "0" ? "-" : period.submissionId}</strong>
                </div>

                <div className="row">
                  <span>Rating</span>
                  <strong>{period.rating === "0" ? "-" : period.rating}</strong>
                </div>

                <div className="row">
                  <span>acceptedAt</span>
                  <strong>{period.acceptedAt === 0 ? "-" : formatTs(period.acceptedAt)}</strong>
                </div>

                <div className="row">
                  <span>resolvedAt</span>
                  <strong>{period.resolvedAt === 0 ? "-" : formatTs(period.resolvedAt)}</strong>
                </div>

                <div className="row proof">
                  <span>proofHash</span>
                  <strong>{period.proofHash === EMPTY_HASH ? "-" : period.proofHash}</strong>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
