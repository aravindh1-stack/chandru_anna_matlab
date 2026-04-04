import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, Droplets, Thermometer, Wifi, Clock, Sparkles } from "lucide-react";
import Chart from "react-apexcharts";

const DEFAULT_CHANNEL_ID = "3281642";
const DEFAULT_READ_API_KEY = "L3VW2XW8YKLYXPM1";
const DEFAULT_REFRESH_SEC = 15;
const MAX_RESULTS = 30;
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const READ_KEY_REGEX = /^[A-Za-z0-9]{16}$/;
const ALERT_THRESHOLDS = {
  spo2Low: 92,
  hrLow: 50,
  hrHigh: 100,
  tempHigh: 38.2,
};
const STORAGE_KEYS = {
  channelId: "aarga.thingspeak.channelId",
  refreshSec: "aarga.thingspeak.refreshSec",
};

const convertTemp = (adc) => {
  if (!adc || adc <= 0) return null;
  const voltage = adc * (3.3 / 1023.0);
  if (voltage <= 0) return null;
  const resistance = ((3.3 - voltage) * 10000) / voltage;
  if (!Number.isFinite(resistance) || resistance <= 0) return null;
  const temp = 1.0 / (Math.log(resistance / 10000) / 3950 + 1.0 / (25 + 273.15)) - 273.15;
  return Number.isFinite(temp) ? Number(temp.toFixed(1)) : null;
};

const toNumOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sanitizeSeries = (values, min, max) => {
  let lastValid = null;
  return values.map((value) => {
    if (value !== null && value >= min && value <= max) {
      lastValid = value;
      return value;
    }
    return lastValid;
  });
};

const smoothSeries = (values, windowSize = 3) => {
  return values.map((_, index) => {
    const start = Math.max(0, index - (windowSize - 1));
    const window = values.slice(start, index + 1).filter((value) => Number.isFinite(value));
    if (!window.length) return null;
    const sum = window.reduce((total, value) => total + value, 0);
    return Number((sum / window.length).toFixed(2));
  });
};

const getLatestFinite = (values) => {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(values[index])) {
      return values[index];
    }
  }
  return null;
};

const Pill = ({ children, tone = "slate" }) => {
  const tones = {
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  };

  return (
    <span className={`inline-flex items-center gap-2 border px-3 py-1.5 rounded-full text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
};

const MetricCard = ({ title, value, unit, subtitle, icon, progressColor, percent }) => (
  <article className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
    <div className={`absolute inset-x-0 top-0 h-1 ${progressColor}`} />
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{title}</p>
        <p className="mt-4 text-4xl font-black tracking-tight text-slate-900">{value}</p>
        <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{unit}</p>
      </div>
      <div className="h-11 w-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-lg">
        {icon}
      </div>
    </div>

    <div className="mt-5">
      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${progressColor}`}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
      <p className="mt-2 text-xs font-medium text-slate-500">{subtitle}</p>
    </div>
  </article>
);

const TrendCard = ({ title, subTitle, options, series, type = "area", height = 290 }) => (
  <article className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
    <div className="mb-5 flex items-center justify-between gap-3">
      <div>
        <h3 className="text-lg font-extrabold tracking-tight text-slate-900">{title}</h3>
        <p className="text-sm text-slate-500">{subTitle}</p>
      </div>
      <Pill tone="indigo">
        <Sparkles size={14} /> Live
      </Pill>
    </div>
    <Chart options={options} series={series} type={type} height={height} />
  </article>
);

const AlertPopup = ({ alerts, onClose, onSnooze }) => (
  <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
    <div className="w-full max-w-lg rounded-3xl border border-rose-300 bg-white shadow-2xl">
      <div className="border-b border-rose-200 bg-rose-50 px-5 py-4">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-rose-700">Disclaimer Alert</p>
        <h3 className="mt-1 text-xl font-extrabold text-rose-900">Patient Vitals Need Attention</h3>
        <p className="mt-2 text-xs font-medium text-rose-700">
          Please verify sensor placement and patient condition before clinical action.
        </p>
      </div>

      <div className="space-y-2 px-5 py-4">
        {alerts.map((alertText) => (
          <p key={alertText} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
            {alertText}
          </p>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-1">
        <button
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
          onClick={onSnooze}
        >
          Snooze 2 min
        </button>
        <button className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white" onClick={onClose}>
          Acknowledge
        </button>
      </div>
    </div>
  </div>
);

const App = () => {
  const [channelIdInput, setChannelIdInput] = useState(() => localStorage.getItem(STORAGE_KEYS.channelId) || DEFAULT_CHANNEL_ID);
  const [readApiKeyInput, setReadApiKeyInput] = useState(DEFAULT_READ_API_KEY);
  const [refreshSecInput, setRefreshSecInput] = useState(() => Number(localStorage.getItem(STORAGE_KEYS.refreshSec) || DEFAULT_REFRESH_SEC));

  const [activeChannelId, setActiveChannelId] = useState(channelIdInput);
  const [activeRefreshSec, setActiveRefreshSec] = useState(refreshSecInput);
  const [isConnected, setIsConnected] = useState(false);

  const [feeds, setFeeds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("Not Connected");
  const [error, setError] = useState("");
  const [popupMutedUntilMs, setPopupMutedUntilMs] = useState(0);
  const [lastNativeAlertKey, setLastNativeAlertKey] = useState("");

  useEffect(() => {
    if (!isConnected) {
      return undefined;
    }

    const fetchData = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/feeds?results=${MAX_RESULTS}`);
        if (!res.ok) {
          throw new Error("ThingSpeak request failed");
        }
        const data = await res.json();
        setFeeds(data.feeds || []);
        setActiveChannelId(data.channelId || activeChannelId);
        setConnectionStatus("Connected");
        setError("");
      } catch (error) {
        setConnectionStatus("Connection Failed");
        setError("Unable to fetch data. Start the app with npm run dev so frontend and backend run together.");
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const safeRefresh = Math.max(5, Number(activeRefreshSec) || DEFAULT_REFRESH_SEC);
    const interval = setInterval(fetchData, safeRefresh * 1000);
    return () => clearInterval(interval);
  }, [activeChannelId, activeRefreshSec, isConnected]);

  const handleConnect = () => {
    const nextChannel = channelIdInput.trim();
    const nextKey = readApiKeyInput.trim();
    const nextRefresh = Math.max(5, Number(refreshSecInput) || DEFAULT_REFRESH_SEC);

    if (!nextChannel) {
      setConnectionStatus("Channel ID required");
      return;
    }

    if (!nextKey) {
      setConnectionStatus("Read API Key required");
      setError("Please paste your Read API Key, then click Connect.");
      return;
    }

    if (!READ_KEY_REGEX.test(nextKey)) {
      setConnectionStatus("Invalid API Key");
      setError("Read API Key must be exactly 16 letters/numbers.");
      return;
    }

    const applyConfig = async () => {
      try {
        setConnectionStatus("Verifying...");
        setLoading(true);

        const response = await fetch(`${API_BASE}/api/config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId: nextChannel, readApiKey: nextKey }),
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
          setConnectionStatus("Authentication Failed");
          setError(data.error || "Connection rejected by server.");
          setLoading(false);
          setIsConnected(false);
          return;
        }

        localStorage.setItem(STORAGE_KEYS.channelId, nextChannel);
        localStorage.setItem(STORAGE_KEYS.refreshSec, String(nextRefresh));

        setActiveChannelId(nextChannel);
        setActiveRefreshSec(nextRefresh);
        setIsConnected(true);
        setError("");
      } catch {
        setConnectionStatus("Connection Failed");
        setError("Cannot reach the backend server. Start the app with npm run dev.");
        setLoading(false);
        setIsConnected(false);
      }
    };

    applyConfig();
  };

  const rawSpo2 = feeds.map((feed) => toNumOrNull(feed.field1));
  const rawHr = feeds.map((feed) => toNumOrNull(feed.field2));
  const rawTemp = feeds.map((feed) => convertTemp(Number(feed.field3)));

  const latestRawSpo2 = getLatestFinite(rawSpo2);
  const latestRawHr = getLatestFinite(rawHr);
  const latestRawTemp = getLatestFinite(rawTemp);

  const spo2SeriesData = smoothSeries(sanitizeSeries(rawSpo2, 60, 100), 3);
  const hrSeriesData = smoothSeries(sanitizeSeries(rawHr, 35, 220), 3);
  const tempSeriesData = smoothSeries(sanitizeSeries(rawTemp, 20, 50), 3);

  const latestSpo2 = spo2SeriesData[spo2SeriesData.length - 1] ?? 0;
  const latestHr = hrSeriesData[hrSeriesData.length - 1] ?? 0;
  const latestTemp = tempSeriesData[tempSeriesData.length - 1] ?? null;

  const activeAlerts = useMemo(() => {
    const alerts = [];
    if (!isConnected || !feeds.length) return alerts;

    if (latestRawSpo2 !== null && latestRawSpo2 > 0 && latestRawSpo2 < ALERT_THRESHOLDS.spo2Low) {
      alerts.push(`Low SpO2 detected (${latestRawSpo2.toFixed(0)}%).`);
    }
    if (latestRawHr !== null && latestRawHr > 0 && latestRawHr < ALERT_THRESHOLDS.hrLow) {
      alerts.push(`Heart rate too low (${latestRawHr.toFixed(0)} BPM).`);
    }
    if (latestRawHr !== null && latestRawHr > ALERT_THRESHOLDS.hrHigh) {
      alerts.push(`Heart rate too high (${latestRawHr.toFixed(0)} BPM).`);
    }
    if (latestRawTemp !== null && latestRawTemp > ALERT_THRESHOLDS.tempHigh) {
      alerts.push(`Temperature elevated (${latestRawTemp.toFixed(1)}°C).`);
    }
    if (latestRawTemp === null) {
      alerts.push("Temperature signal unavailable. Check sensor and field mapping.");
    }

    return alerts;
  }, [feeds.length, isConnected, latestRawHr, latestRawSpo2, latestRawTemp]);

  const alertKey = activeAlerts.join("|");

  useEffect(() => {
    if (!activeAlerts.length || !alertKey) {
      return;
    }

    if (alertKey === lastNativeAlertKey) {
      return;
    }

    setLastNativeAlertKey(alertKey);

    // Native fallback popup for critical visibility in case modal layering fails.
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(`Critical Alert\n\n${activeAlerts.join("\n")}`);
    }
  }, [activeAlerts, alertKey, lastNativeAlertKey]);

  useEffect(() => {
    if (!popupMutedUntilMs) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setPopupMutedUntilMs(0);
    }, Math.max(0, popupMutedUntilMs - Date.now()));

    return () => window.clearTimeout(timeoutId);
  }, [popupMutedUntilMs]);

  const shouldShowAlertPopup = activeAlerts.length > 0 && Date.now() >= popupMutedUntilMs;

  const categories = feeds.map((feed) =>
    new Date(feed.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );

  const baseChartOptions = useMemo(
    () => ({
      chart: {
        toolbar: { show: false },
        zoom: { enabled: false },
        background: "transparent",
        animations: { enabled: false },
      },
      dataLabels: { enabled: false },
      stroke: { curve: "smooth", width: 3 },
      fill: {
        type: "gradient",
        gradient: {
          shadeIntensity: 1,
          opacityFrom: 0.18,
          opacityTo: 0.03,
          stops: [0, 90, 100],
        },
      },
      xaxis: {
        categories,
        labels: {
          style: {
            colors: "#64748b",
            fontSize: "11px",
          },
        },
      },
      yaxis: {
        labels: {
          style: {
            colors: "#64748b",
            fontSize: "11px",
          },
        },
      },
      grid: {
        borderColor: "#e2e8f0",
        strokeDashArray: 4,
      },
      tooltip: { theme: "light" },
    }),
    [categories]
  );

  const spo2Series = [
    {
      name: "SpO2",
      data: spo2SeriesData,
    },
  ];

  const hrSeries = [
    {
      name: "BPM",
      data: hrSeriesData,
    },
  ];

  const tempSeries = [
    {
      name: "Temperature",
      data: tempSeriesData,
    },
  ];

  const combinedSeries = [
    { name: "SpO2", data: spo2SeriesData },
    { name: "BPM", data: hrSeriesData },
    { name: "Temp", data: tempSeriesData },
  ];

  const spo2Options = {
    ...baseChartOptions,
    colors: ["#4f46e5"],
    yaxis: { ...baseChartOptions.yaxis, max: 100 },
  };

  const hrOptions = {
    ...baseChartOptions,
    colors: ["#334155"],
    yaxis: { ...baseChartOptions.yaxis, max: 200 },
  };

  const tempOptions = {
    ...baseChartOptions,
    colors: ["#10b981"],
    yaxis: { ...baseChartOptions.yaxis, max: 50 },
  };

  const combinedOptions = {
    ...baseChartOptions,
    colors: ["#4f46e5", "#334155", "#10b981"],
    stroke: { curve: "smooth", width: 2 },
    fill: { ...baseChartOptions.fill, opacity: 0.1 },
    legend: { show: true, position: "top" },
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8">
      {shouldShowAlertPopup && typeof document !== "undefined"
        ? createPortal(
            <AlertPopup
              alerts={activeAlerts}
              onClose={() => setPopupMutedUntilMs(Date.now() + 15 * 1000)}
              onSnooze={() => {
                setPopupMutedUntilMs(Date.now() + 2 * 60 * 1000);
              }}
            />,
            document.body
          )
        : null}

      <div className="mx-auto max-w-[1320px] space-y-8">
        <header className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 md:p-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center">
              <Activity size={24} />
            </div>
            <div>
              <p className="text-xs md:text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 mt-1">Cardiac Recovery Monitor</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Pill tone="emerald">
              <span className="inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              System Live
            </Pill>
            <Pill>
              <Clock size={14} />
              {new Date().toLocaleTimeString()}
            </Pill>
            <Pill tone="indigo">
              <Wifi size={14} />
              Channel {isConnected ? activeChannelId : "--"}
            </Pill>
            <Pill tone={connectionStatus === "Connected" ? "emerald" : "slate"}>
              {connectionStatus}
            </Pill>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 md:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 mb-4">ThingSpeak Connection</p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <input
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Channel ID"
              value={channelIdInput}
              onChange={(event) => setChannelIdInput(event.target.value)}
            />
            <input
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Read API Key (for private channels)"
              value={readApiKeyInput}
              onChange={(event) => setReadApiKeyInput(event.target.value)}
            />
            <input
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              type="number"
              min={5}
              placeholder="Refresh Seconds"
              value={refreshSecInput}
              onChange={(event) => setRefreshSecInput(event.target.value)}
            />
            <button className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-semibold" onClick={handleConnect}>
              Connect
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Use Channel ID and Read API Key from `thingspeak.mathworks.com`. Data fetch starts only after successful Connect.
          </p>
          {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
        </section>

        <main className="grid grid-cols-1 xl:grid-cols-12 gap-7">
          <section className="xl:col-span-8 flex flex-col lg:flex-row gap-6">
            <MetricCard
              title="SpO2"
              value={`${latestSpo2.toFixed(0)}%`}
              unit="Oxygen Saturation"
              subtitle="Filtered + smoothed from Field 1"
              icon={<Droplets size={20} />}
              progressColor="bg-indigo-500"
              percent={latestSpo2}
            />
            <MetricCard
              title="Heart Rate"
              value={`${latestHr.toFixed(0)}`}
              unit="BPM"
              subtitle="Filtered + smoothed from Field 2"
              icon={<Activity size={20} />}
              progressColor="bg-slate-700"
              percent={(latestHr / 180) * 100}
            />
            <MetricCard
              title="Body Temperature"
              value={latestTemp === null ? "--" : `${latestTemp.toFixed(1)}°`}
              unit="Celsius"
              subtitle="MATLAB converted + smoothed Field 3"
              icon={<Thermometer size={20} />}
              progressColor="bg-emerald-500"
              percent={latestTemp === null ? 0 : (latestTemp / 45) * 100}
            />
          </section>

          <section className="xl:col-span-4 space-y-6">
            <article className="rounded-2xl border border-slate-800 bg-slate-900 text-white p-7 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">Device Status</p>
              <h3 className="mt-4 text-2xl font-black tracking-tight">Cardiac Band v2</h3>
              <p className="mt-2 text-sm text-slate-300">Signal processing active with range filtering and smoothing.</p>
              <div className="mt-6">
                <div className="flex items-center justify-between text-xs text-slate-300 mb-2">
                  <span>Signal Strength</span>
                  <span className="font-bold text-emerald-400">{loading ? "--" : "98%"}</span>
                </div>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full w-[98%] bg-emerald-400 rounded-full" />
                </div>
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">Analytics Note</p>
              <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-800">
                Real-time telemetry is transformed with MATLAB-equivalent conversion logic to keep temperature interpretation accurate and stable.
              </p>
            </article>
          </section>

          <section className="xl:col-span-12 grid grid-cols-1 md:grid-cols-2 gap-6">
            <TrendCard
              title="SpO2 Trend"
              subTitle="Last 20 feeds • Field 1"
              options={spo2Options}
              series={spo2Series}
              type="line"
              height={240}
            />
            <TrendCard
              title="Heart Rate Trend"
              subTitle="Last 20 feeds • Field 2"
              options={hrOptions}
              series={hrSeries}
              type="area"
              height={240}
            />
            <TrendCard
              title="Temperature Trend"
              subTitle="Last 20 feeds • Field 3 (MATLAB converted)"
              options={tempOptions}
              series={tempSeries}
              type="line"
              height={240}
            />
            <TrendCard
              title="Combined Vitals"
              subTitle="SpO2 + BPM + Temp"
              options={combinedOptions}
              series={combinedSeries}
              type="line"
              height={240}
            />
          </section>
        </main>
      </div>
    </div>
  );
};

export default App;
