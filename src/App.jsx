import React, { useEffect, useMemo, useState } from "react";
import { Activity, Droplets, Thermometer, Wifi, Clock, Sparkles, Download } from "lucide-react";
import Chart from "react-apexcharts";

const DEFAULT_CHANNEL_ID = "3281642";
const DEFAULT_READ_API_KEY = "L3VW2XW8YKLYXPM1";
const DEFAULT_REFRESH_SEC = 15;
const MAX_RESULTS = 30;
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const READ_KEY_REGEX = /^[A-Za-z0-9]{16}$/;
const ALERT_THRESHOLDS = {
  spo2Low: 94,
  hrLow: 60,
  hrHigh: 100,
  tempHigh: 38.0,
};
const DANGER_LIMITS = {
  spo2Low: 90,
  hrHigh: 130,
  tempHigh: 39.5,
};
const STORAGE_KEYS = {
  channelId: "aarga.thingspeak.channelId",
  refreshSec: "aarga.thingspeak.refreshSec",
};

const buildThingSpeakClientUrl = (channelId, readApiKey, results = 30) =>
  `https://api.thingspeak.com/channels/${encodeURIComponent(channelId)}/feeds.json?results=${results}&api_key=${encodeURIComponent(readApiKey)}`;

const getSeriesStats = (values) => {
  const safeValues = values.filter((value) => Number.isFinite(value));
  if (!safeValues.length) {
    return { latest: null, min: null, max: null, average: null, trend: "No data" };
  }

  const latest = safeValues[safeValues.length - 1];
  const min = Math.min(...safeValues);
  const max = Math.max(...safeValues);
  const average = safeValues.reduce((total, value) => total + value, 0) / safeValues.length;
  const trendWindow = safeValues.slice(Math.max(0, safeValues.length - 6));
  const trendDelta = trendWindow.length > 1 ? trendWindow[trendWindow.length - 1] - trendWindow[0] : 0;

  let trend = "Stable";
  if (trendDelta > 1.5) trend = "Rising";
  if (trendDelta < -1.5) trend = "Falling";

  return {
    latest: Number(latest.toFixed(2)),
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    average: Number(average.toFixed(2)),
    trend,
  };
};

const buildClinicalRecommendations = ({ spo2Stats, hrStats, tempStats, dangerLimits = DANGER_LIMITS }) => {
  const recommendations = [];
  
  // Check DANGER thresholds first (most critical)
  if (spo2Stats.latest !== null && spo2Stats.latest < dangerLimits.spo2Low) {
    recommendations.push(`🔴 DANGER: SpO2 ${spo2Stats.latest}% - CRITICAL. Immediate medical attention required. Check airway, oxygen therapy status.`);
  } else if (spo2Stats.latest !== null && spo2Stats.latest < ALERT_THRESHOLDS.spo2Low) {
    recommendations.push("Recheck SpO2 probe fit and repeat reading in 2 minutes.");
  }
  
  if (hrStats.latest !== null && hrStats.latest > dangerLimits.hrHigh) {
    recommendations.push(`🔴 DANGER: Heart Rate ${hrStats.latest} BPM - CRITICAL. Tachycardia alert. Monitor closely, evaluate cause.`);
  } else if (hrStats.latest !== null && (hrStats.latest < ALERT_THRESHOLDS.hrLow || hrStats.latest > ALERT_THRESHOLDS.hrHigh)) {
    recommendations.push("Confirm pulse manually and correlate with patient symptoms.");
  }
  
  if (tempStats.latest !== null && tempStats.latest > dangerLimits.tempHigh) {
    recommendations.push(`🔴 DANGER: Temperature ${tempStats.latest}°C - CRITICAL FEVER. High fever alert. Immediate cooling measures and medical evaluation needed.`);
  } else if (tempStats.latest !== null && tempStats.latest > ALERT_THRESHOLDS.tempHigh) {
    recommendations.push("Evaluate for fever protocol and hydration status.");
  }
  
  if (!recommendations.length) {
    recommendations.push("Continue routine observation. No immediate escalation required.");
  }
  return recommendations;
};

const downloadClinicalPdf = ({ patientName, patientDetails, channelId, refreshSec, spo2Stats, hrStats, tempStats, activeAlerts, isConnected, dangerLimits = DANGER_LIMITS }) => {
  const safeValue = (value, suffix = "") => (value === null ? "N/A" : `${value}${suffix}`);
  const recommendations = buildClinicalRecommendations({ spo2Stats, hrStats, tempStats, dangerLimits });
  const now = new Date().toLocaleString();
  const patientDisplayName = patientName.trim() || "Unknown Patient";
  const patientDisplayDetails = patientDetails.trim() || "Not provided";
  const alertsHtml = activeAlerts.length
    ? `<ul>${activeAlerts.map((alert) => `<li>${alert}</li>`).join("")}</ul>`
    : "<p>No active threshold breaches.</p>";
  const recommendationsHtml = recommendations
    .map((item) => `<li>${item}</li>`)
    .join("");

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cardiac Monitoring Clinical Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: A4 portrait; margin: 10mm; }
    body { font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; color: #0f172a; line-height: 1.5; }
    .container { width: 100%; max-width: 190mm; margin: 0 auto; padding: 0; }
    .header { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: white; padding: 18px 20px; border-radius: 8px; margin-bottom: 14px; }
    .header h1 { font-size: 24px; margin-bottom: 6px; }
    .header p { font-size: 13px; opacity: 0.92; }
    .patient-box { background: linear-gradient(135deg, #dbeafe 0%, #e0f2fe 100%); border: 1px solid #0284c7; padding: 14px 16px; margin-bottom: 12px; border-radius: 8px; }
    .patient-box h3 { font-size: 15px; color: #0c4a6e; margin-bottom: 8px; font-weight: 700; }
    .patient-info { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .patient-field p { font-size: 12px; color: #0369a1; margin-bottom: 3px; font-weight: 600; }
    .patient-field .value { font-size: 14px; color: #0c4a6e; font-weight: 700; }
    .meta-box { background: #f8fafc; border-left: 3px solid #3b82f6; padding: 10px 12px; margin-bottom: 12px; border-radius: 4px; }
    .meta-box p { font-size: 12px; margin: 3px 0; }
    .meta-box strong { color: #1e293b; }
    .section { margin-bottom: 12px; }
    .section h2 { font-size: 16px; color: #1e293b; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { background: #eff6ff; color: #0c4a6e; padding: 8px 7px; text-align: center; font-size: 12px; font-weight: 700; border: 1px solid #cbd5e1; }
    td { padding: 8px 7px; border: 1px solid #e2e8f0; text-align: center; font-size: 12px; }
    td.metric { text-align: left; font-weight: 700; }
    tr:nth-child(even) { background: #f8fafc; }
    .safe-box { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 9px 10px; margin-top: 8px; }
    .safe-box h3 { font-size: 12px; color: #334155; margin-bottom: 6px; }
    .safe-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
    .safe-grid p { font-size: 11px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px 7px; }
    ul { margin-left: 14px; }
    ul li { margin: 5px 0; font-size: 12px; }
    p { font-size: 12px; }
    .note { background: #fef3c7; border-left: 3px solid #f59e0b; padding: 10px 12px; font-size: 11px; color: #78350f; border-radius: 4px; }
    @media print {
      body { padding: 0; }
      .container { max-width: 100%; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Cardiac Monitoring Clinical Report</h1>
      <p>Generated: ${now} | Channel: ${channelId} | Status: ${isConnected ? "Connected" : "Offline"}</p>
    </div>

    <div class="patient-box">
      <h3>Patient Information</h3>
      <div class="patient-info">
        <div class="patient-field">
          <p>Patient Name</p>
          <div class="value">${patientDisplayName}</div>
        </div>
        <div class="patient-field">
          <p>Patient ID / Age / Details</p>
          <div class="value">${patientDisplayDetails}</div>
        </div>
      </div>
    </div>

    <div class="meta-box">
      <p><strong>Monitoring Interval:</strong> ${refreshSec} seconds</p>
      <p><strong>Report Type:</strong> Real-time Vitals Summary</p>
      <p><strong>Data Quality:</strong> ${isConnected ? "Active" : "Stale"}</p>
    </div>

    <div class="section">
      <h2>Vitals Summary</h2>
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Latest</th>
            <th>Average</th>
            <th>Minimum</th>
            <th>Maximum</th>
            <th>Trend</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="metric">SpO<sub>2</sub></td>
            <td>${safeValue(spo2Stats.latest, "%")}</td>
            <td>${safeValue(spo2Stats.average, "%")}</td>
            <td>${safeValue(spo2Stats.min, "%")}</td>
            <td>${safeValue(spo2Stats.max, "%")}</td>
            <td>${spo2Stats.trend}</td>
          </tr>
          <tr>
            <td class="metric">Heart Rate</td>
            <td>${safeValue(hrStats.latest, " BPM")}</td>
            <td>${safeValue(hrStats.average, " BPM")}</td>
            <td>${safeValue(hrStats.min, " BPM")}</td>
            <td>${safeValue(hrStats.max, " BPM")}</td>
            <td>${hrStats.trend}</td>
          </tr>
          <tr>
            <td class="metric">Temperature</td>
            <td>${safeValue(tempStats.latest, " °C")}</td>
            <td>${safeValue(tempStats.average, " °C")}</td>
            <td>${safeValue(tempStats.min, " °C")}</td>
            <td>${safeValue(tempStats.max, " °C")}</td>
            <td>${tempStats.trend}</td>
          </tr>
        </tbody>
      </table>

      <div class="safe-box">
        <h3>SL (Safe Limits)</h3>
        <div class="safe-grid">
          <p>SpO2: Minimum ${ALERT_THRESHOLDS.spo2Low}%</p>
          <p>Heart Rate: From ${ALERT_THRESHOLDS.hrLow} to ${ALERT_THRESHOLDS.hrHigh} BPM</p>
          <p>Temperature: Maximum ${ALERT_THRESHOLDS.tempHigh.toFixed(1)} deg C</p>
        </div>
      </div>
    </div>

    <div class="section">
      <div>
        <h2>Active Alerts</h2>
        ${alertsHtml}
      </div>
    </div>

    <div class="section">
      <div>
        <h2>AI Recommendations</h2>
        <ul>
          ${recommendationsHtml}
        </ul>
      </div>
    </div>

    <div class="note">
      <strong>Clinical Disclaimer:</strong> This is a monitoring support report and does not replace physician judgment.
    </div>
  </div>

  <script>
    window.onload = function() {
      window.print();
    };
  </script>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const newWindow = window.open(url, "_blank");
  if (newWindow) {
    newWindow.onbeforeunload = function() {
      URL.revokeObjectURL(url);
    };
  }
};

const convertTemp = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  // Accept direct Celsius values when the device already sends temperature.
  if (parsed >= 20 && parsed <= 50) {
    return Number(parsed.toFixed(1));
  }

  // Otherwise, treat field3 as ADC and convert through NTC formula.
  if (parsed <= 0) return null;
  const voltage = parsed * (3.3 / 1023.0);
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

const AlertPopup = ({ alerts, onAcknowledge, onSnooze }) => (
  <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
    <div className="w-full max-w-3xl rounded-3xl border border-rose-300 bg-white shadow-2xl overflow-hidden">
      <div className="bg-rose-600 px-6 py-5 text-white">
        <p className="text-xs font-bold uppercase tracking-[0.2em]">Critical Alert</p>
        <h1 className="mt-2 text-2xl md:text-3xl font-black">Patient Vitals Need Attention</h1>
        <p className="mt-2 text-sm text-rose-100">Review all alerts before continuing.</p>
      </div>

      <div className="space-y-3 px-6 py-6">
        {alerts.map((alertText) => (
          <p key={alertText} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            {alertText}
          </p>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 px-6 pb-6 pt-1">
        <button
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
          onClick={onAcknowledge}
        >
          Acknowledge 15 sec
        </button>
        <button className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white" onClick={onSnooze}>
          Snooze 2 min
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
  const [activeReadApiKey, setActiveReadApiKey] = useState(readApiKeyInput);
  const [isConnected, setIsConnected] = useState(false);
  const [useDirectMode, setUseDirectMode] = useState(false);

  const [feeds, setFeeds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("Not Connected");
  const [error, setError] = useState("");
  const [apiError, setApiError] = useState("");
  const [popupMutedUntilMs, setPopupMutedUntilMs] = useState(0);
  const [lastAlertSignature, setLastAlertSignature] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientDetails, setPatientDetails] = useState("");
  const [showReportModal, setShowReportModal] = useState(false);

  useEffect(() => {
    if (!isConnected) {
      return undefined;
    }

    const fetchData = async () => {
      try {
        if (useDirectMode) {
          const directUrl = buildThingSpeakClientUrl(activeChannelId, activeReadApiKey, MAX_RESULTS);
          const directRes = await fetch(directUrl);
          if (!directRes.ok) {
            throw new Error(`ThingSpeak direct request failed (${directRes.status})`);
          }
          const directData = await directRes.json();
          setFeeds(directData.feeds || []);
          setConnectionStatus("Connected (Direct Mode)");
        } else {
          const res = await fetch(`${API_BASE}/api/feeds?results=${MAX_RESULTS}`);
          if (!res.ok) {
            throw new Error("ThingSpeak request failed");
          }
          const data = await res.json();
          setFeeds(data.feeds || []);
          setActiveChannelId(data.channelId || activeChannelId);
          setConnectionStatus("Connected");
        }
        setError("");
        setApiError("");
      } catch (error) {
        setConnectionStatus("Connection Failed");
        setError("Unable to fetch data. Please check your internet connection or deployment status.");
        setApiError("API connection lost. Please verify deployment and network connectivity.");
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const safeRefresh = Math.max(5, Number(activeRefreshSec) || DEFAULT_REFRESH_SEC);
    const interval = setInterval(fetchData, safeRefresh * 1000);
    return () => clearInterval(interval);
  }, [activeChannelId, activeReadApiKey, activeRefreshSec, isConnected, useDirectMode]);

  const handleConnect = () => {
    if (!patientName.trim()) {
      setConnectionStatus("Patient Name Required");
      setError("Please enter patient name to proceed.");
      return;
    }

    if (!patientDetails.trim()) {
      setConnectionStatus("Patient ID/Details Required");
      setError("Please enter patient ID or details to proceed.");
      return;
    }

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
      const connectDirectMode = async () => {
        const testUrl = buildThingSpeakClientUrl(nextChannel, nextKey, 1);
        const directResponse = await fetch(testUrl);
        if (!directResponse.ok) {
          throw new Error(`ThingSpeak direct auth failed (${directResponse.status})`);
        }
        const directData = await directResponse.json();
        if (directData.status === "0" || directData.error || !directData.channel) {
          throw new Error("Invalid Channel ID or Read API Key.");
        }

        localStorage.setItem(STORAGE_KEYS.channelId, nextChannel);
        localStorage.setItem(STORAGE_KEYS.refreshSec, String(nextRefresh));

        setActiveChannelId(nextChannel);
        setActiveReadApiKey(nextKey);
        setActiveRefreshSec(nextRefresh);
        setUseDirectMode(true);
        setIsConnected(true);
        setConnectionStatus("Connected (Direct Mode)");
        setError("Server API unavailable. Connected via direct ThingSpeak mode.");
        setApiError("");
      };

      try {
        setConnectionStatus("Verifying...");
        setLoading(true);

        const response = await fetch(`${API_BASE}/api/config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId: nextChannel, readApiKey: nextKey }),
        });

        let data = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }

        if (!response.ok || !data.ok) {
          if (response.status >= 500 || response.status === 404 || !data) {
            await connectDirectMode();
            return;
          }
          setConnectionStatus("Authentication Failed");
          setError((data && data.error) || "Connection rejected by server.");
          setApiError((data && data.error) || "Authentication failed. Please verify your credentials.");
          setLoading(false);
          setIsConnected(false);
          return;
        }

        localStorage.setItem(STORAGE_KEYS.channelId, nextChannel);
        localStorage.setItem(STORAGE_KEYS.refreshSec, String(nextRefresh));

        setActiveChannelId(nextChannel);
        setActiveReadApiKey(nextKey);
        setActiveRefreshSec(nextRefresh);
        setUseDirectMode(false);
        setIsConnected(true);
        setError("");
        setApiError("");
      } catch (error) {
        try {
          await connectDirectMode();
        } catch {
          setConnectionStatus("Connection Failed");
          setError("Connection failed. Please verify API deployment and try again.");
          setApiError("Connection failed. API may not be deployed or network is unavailable.");
          setIsConnected(false);
        }
      } finally {
        setLoading(false);
      }
    };

    applyConfig();
  };

  const rawSpo2 = feeds.map((feed) => toNumOrNull(feed.field1));
  const rawHr = feeds.map((feed) => toNumOrNull(feed.field2));
  const rawTemp = feeds.map((feed) => convertTemp(feed.field3));

  const spo2SeriesData = smoothSeries(sanitizeSeries(rawSpo2, 60, 100), 3);
  const hrSeriesData = smoothSeries(sanitizeSeries(rawHr, 35, 220), 3);
  const tempSeriesData = smoothSeries(sanitizeSeries(rawTemp, 20, 50), 3);

  const latestSpo2 = spo2SeriesData[spo2SeriesData.length - 1] ?? 0;
  const latestHr = hrSeriesData[hrSeriesData.length - 1] ?? 0;
  const latestTemp = tempSeriesData[tempSeriesData.length - 1] ?? null;
  const spo2Stats = useMemo(() => getSeriesStats(spo2SeriesData), [spo2SeriesData]);
  const hrStats = useMemo(() => getSeriesStats(hrSeriesData), [hrSeriesData]);
  const tempStats = useMemo(() => getSeriesStats(tempSeriesData), [tempSeriesData]);

  const activeAlerts = useMemo(() => {
    const alerts = [];

    if (apiError) {
      alerts.push(apiError);
    }

    if (!isConnected || !feeds.length) return alerts;

    // Check DANGER thresholds first (most critical - RED)
    if (latestSpo2 > 0 && latestSpo2 < DANGER_LIMITS.spo2Low) {
      alerts.push(`🔴 DANGER: SpO2 ${latestSpo2.toFixed(0)}% CRITICAL (below ${DANGER_LIMITS.spo2Low}%)`);
    } else if (latestSpo2 > 0 && latestSpo2 < ALERT_THRESHOLDS.spo2Low) {
      alerts.push(`⚠️ CAUTION: SpO2 ${latestSpo2.toFixed(0)}% (below ${ALERT_THRESHOLDS.spo2Low}%)`);
    }
    
    if (latestHr > DANGER_LIMITS.hrHigh) {
      alerts.push(`🔴 DANGER: Heart Rate ${latestHr.toFixed(0)} BPM CRITICAL (above ${DANGER_LIMITS.hrHigh} BPM)`);
    } else if (latestHr > ALERT_THRESHOLDS.hrHigh) {
      alerts.push(`⚠️ CAUTION: Heart Rate ${latestHr.toFixed(0)} BPM (above ${ALERT_THRESHOLDS.hrHigh} BPM)`);
    } else if (latestHr > 0 && latestHr < ALERT_THRESHOLDS.hrLow) {
      alerts.push(`⚠️ CAUTION: Heart Rate ${latestHr.toFixed(0)} BPM (below ${ALERT_THRESHOLDS.hrLow} BPM)`);
    }
    
    if (latestTemp !== null && latestTemp > DANGER_LIMITS.tempHigh) {
      alerts.push(`🔴 DANGER: Temperature ${latestTemp.toFixed(1)}°C CRITICAL (above ${DANGER_LIMITS.tempHigh}°C)`);
    } else if (latestTemp !== null && latestTemp > ALERT_THRESHOLDS.tempHigh) {
      alerts.push(`⚠️ CAUTION: Temperature ${latestTemp.toFixed(1)}°C (above ${ALERT_THRESHOLDS.tempHigh}°C)`);
    }
    if (latestTemp === null) {
      alerts.push("Temperature: unavailable (sensor/mapping error)");
    }

    return alerts;
  }, [feeds.length, isConnected, latestHr, latestSpo2, latestTemp, apiError]);

  const shouldShowAlertPopup = activeAlerts.length > 0 && Date.now() >= popupMutedUntilMs;

  const handleViewReport = () => {
    setShowReportModal(true);
  };

  const handleDownloadReport = () => {
    downloadClinicalPdf({
      patientName,
      patientDetails,
      channelId: activeChannelId,
      refreshSec: activeRefreshSec,
      spo2Stats,
      hrStats,
      tempStats,
      activeAlerts,
      isConnected,
    });
  };

  const handleDownloadFromModal = () => {
    downloadClinicalPdf({
      patientName,
      patientDetails,
      channelId: activeChannelId,
      refreshSec: activeRefreshSec,
      spo2Stats,
      hrStats,
      tempStats,
      activeAlerts,
      isConnected,
    });
  };

  useEffect(() => {
    const signature = activeAlerts.join("|");

    if (!signature) {
      setLastAlertSignature("");
      return;
    }

    if (signature !== lastAlertSignature) {
      setLastAlertSignature(signature);
      setPopupMutedUntilMs(0);
    }
  }, [activeAlerts, lastAlertSignature]);

  useEffect(() => {
    if (!popupMutedUntilMs) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setPopupMutedUntilMs(0);
    }, Math.max(0, popupMutedUntilMs - Date.now()));

    return () => window.clearTimeout(timeoutId);
  }, [popupMutedUntilMs]);

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
      stroke: { curve: "smooth", width: 4, lineCap: "round" },
      markers: {
        size: 3,
        strokeWidth: 0,
        hover: { size: 5 },
      },
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
      noData: {
        text: "Waiting for live data...",
        style: { color: "#64748b", fontSize: "13px" },
      },
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
    yaxis: { ...baseChartOptions.yaxis, min: 85, max: 100, tickAmount: 3 },
  };

  const hrOptions = {
    ...baseChartOptions,
    colors: ["#334155"],
    yaxis: { ...baseChartOptions.yaxis, max: 200 },
  };

  const tempOptions = {
    ...baseChartOptions,
    colors: ["#10b981"],
    yaxis: { ...baseChartOptions.yaxis, min: 20, max: 45, tickAmount: 5 },
  };

  const combinedOptions = {
    ...baseChartOptions,
    colors: ["#4f46e5", "#334155", "#10b981"],
    stroke: { curve: "smooth", width: 3, lineCap: "round" },
    fill: { ...baseChartOptions.fill, opacity: 0.1 },
    legend: { show: true, position: "top" },
    yaxis: [
      {
        min: 85,
        max: 100,
        labels: { style: { colors: "#4f46e5", fontSize: "11px" } },
      },
      {
        opposite: true,
        min: 35,
        max: 200,
        labels: { style: { colors: "#334155", fontSize: "11px" } },
      },
      {
        opposite: true,
        min: 20,
        max: 45,
        labels: { style: { colors: "#10b981", fontSize: "11px" } },
      },
    ],
  };

  const lastUpdated = feeds.length ? new Date(feeds[feeds.length - 1].created_at).toLocaleTimeString() : "--:--:--";
  const readingsToday = feeds.length;
  const alertsToday = activeAlerts.length;
  const recoveryScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 -
          (latestSpo2 < ALERT_THRESHOLDS.spo2Low ? (ALERT_THRESHOLDS.spo2Low - latestSpo2) * 3 : 0) -
          (latestHr > ALERT_THRESHOLDS.hrHigh ? (latestHr - ALERT_THRESHOLDS.hrHigh) * 0.8 : 0) -
          (latestHr > 0 && latestHr < ALERT_THRESHOLDS.hrLow ? (ALERT_THRESHOLDS.hrLow - latestHr) * 0.8 : 0) -
          (latestTemp !== null && latestTemp > ALERT_THRESHOLDS.tempHigh ? (latestTemp - ALERT_THRESHOLDS.tempHigh) * 12 : 0)
      )
    )
  );
  const recoveryBand = recoveryScore >= 85 ? "Good" : recoveryScore >= 65 ? "Observe" : "Critical";

  const ReportModal = () => (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-4xl rounded-3xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-5 text-white flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em]">Clinical Report</p>
            <h1 className="mt-2 text-xl font-black">Cardiac Monitoring Summary</h1>
          </div>
          <button
            onClick={() => setShowReportModal(false)}
            className="rounded-lg hover:bg-slate-700 p-2 text-white transition"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 md:p-8 space-y-6">
          {patientName.trim() && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-blue-900">{patientName}</p>
              {patientDetails.trim() && <p className="text-xs text-blue-700 mt-1">{patientDetails}</p>}
            </div>
          )}

          <div>
            <h2 className="text-lg font-bold text-slate-900 mb-3">Vitals Summary</h2>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-4 py-2 text-left text-sm font-bold text-slate-900">Metric</th>
                  <th className="border border-slate-300 px-4 py-2 text-left text-sm font-bold text-slate-900">Latest</th>
                  <th className="border border-slate-300 px-4 py-2 text-left text-sm font-bold text-slate-900">Avg</th>
                  <th className="border border-slate-300 px-4 py-2 text-left text-sm font-bold text-slate-900">Min</th>
                  <th className="border border-slate-300 px-4 py-2 text-left text-sm font-bold text-slate-900">Max</th>
                  <th className="border border-slate-300 px-4 py-2 text-left text-sm font-bold text-slate-900">SL (Safe Limit)</th>
                  <th className="border border-slate-300 px-4 py-2 text-left text-sm font-bold text-slate-900">Trend</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-300 px-4 py-2 text-sm text-slate-700">SpO₂</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm text-slate-700">{spo2Stats.latest === null ? "N/A" : `${spo2Stats.latest}%`}</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm text-slate-700">{spo2Stats.average === null ? "N/A" : `${spo2Stats.average}%`}</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm text-slate-700">{spo2Stats.min === null ? "N/A" : `${spo2Stats.min}%`}</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm text-slate-700">{spo2Stats.max === null ? "N/A" : `${spo2Stats.max}%`}</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm font-semibold text-emerald-700">Minimum {ALERT_THRESHOLDS.spo2Low}%</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">{spo2Stats.trend}</td>
                </tr>
                <tr className="bg-slate-50">
                  <td className="border border-slate-300 px-4 py-2 text-sm text-slate-700">Heart Rate</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm text-slate-700">{hrStats.latest === null ? "N/A" : `${hrStats.latest} BPM`}</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm text-slate-700">{hrStats.average === null ? "N/A" : `${hrStats.average} BPM`}</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm text-slate-700">{hrStats.min === null ? "N/A" : `${hrStats.min} BPM`}</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm text-slate-700">{hrStats.max === null ? "N/A" : `${hrStats.max} BPM`}</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm font-semibold text-emerald-700">From {ALERT_THRESHOLDS.hrLow} to {ALERT_THRESHOLDS.hrHigh} BPM</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">{hrStats.trend}</td>
                </tr>
                <tr>
                  <td className="border border-slate-300 px-4 py-2 text-sm text-slate-700">Temperature</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm text-slate-700">{tempStats.latest === null ? "N/A" : `${tempStats.latest} °C`}</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm text-slate-700">{tempStats.average === null ? "N/A" : `${tempStats.average} °C`}</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm text-slate-700">{tempStats.min === null ? "N/A" : `${tempStats.min} °C`}</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm text-slate-700">{tempStats.max === null ? "N/A" : `${tempStats.max} °C`}</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm font-semibold text-emerald-700">Maximum {ALERT_THRESHOLDS.tempHigh.toFixed(1)} °C</td>
                  <td className="border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">{tempStats.trend}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {activeAlerts.length > 0 && (
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-3">Active Alerts</h2>
              <ul className="space-y-2">
                {activeAlerts.map((alert, idx) => (
                  <li key={idx} className="bg-red-50 border-l-4 border-red-600 px-4 py-3 text-sm text-red-900 rounded">
                    {alert}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 flex flex-wrap gap-3 justify-end">
          <button
            onClick={() => setShowReportModal(false)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition"
          >
            Close
          </button>
          <button
            onClick={handleDownloadFromModal}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition"
          >
            <Download size={16} /> Download PDF
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-indigo-50 p-4 md:p-6">
      {showReportModal && <ReportModal />}
      {shouldShowAlertPopup ? (
        <AlertPopup
          alerts={activeAlerts}
          onAcknowledge={() => {
            setPopupMutedUntilMs(Date.now() + 15 * 1000);
          }}
          onSnooze={() => {
            setPopupMutedUntilMs(Date.now() + 2 * 60 * 1000);
          }}
        />
      ) : null}

      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm md:px-7 md:py-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-lg">
              <Activity size={22} />
            </div>
            <div>
              <p className="text-xl font-black tracking-tight text-slate-900">CardioWatch AI</p>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">IoT Cardiac Monitoring System</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="emerald">
              <span className="inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              LIVE MONITORING
            </Pill>
            <Pill>
              <Clock size={14} /> Last update {lastUpdated}
            </Pill>
            <Pill tone="indigo">
              <Wifi size={14} /> Channel {isConnected ? activeChannelId : "--"}
            </Pill>
            <Pill tone={connectionStatus === "Connected" ? "emerald" : "slate"}>{connectionStatus}</Pill>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadReport}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Download PDF
            </button>
            <button
              onClick={handleViewReport}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition"
            >
              AI Report
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm h-fit xl:sticky xl:top-4 xl:self-start xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
              <div className="h-11 w-11 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">P</div>
              <div>
                <p className="text-sm font-bold text-slate-900">{patientName.trim() || "Patient"}</p>
                <p className="text-xs text-slate-500">{patientDetails.trim() || "ID: --"}</p>
                <p className="mt-1 text-xs font-semibold text-emerald-700">Post-Cardiac Recovery</p>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-2">Normal Ranges</p>
              <div className="space-y-2">
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 flex items-center justify-between"><span>Heart Rate</span><span>{ALERT_THRESHOLDS.hrLow} - {ALERT_THRESHOLDS.hrHigh} BPM</span></div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 flex items-center justify-between"><span>SpO2</span><span>Minimum {ALERT_THRESHOLDS.spo2Low}%</span></div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 flex items-center justify-between"><span>Temperature</span><span>Maximum {ALERT_THRESHOLDS.tempHigh.toFixed(1)} deg C</span></div>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-2">Quick Stats</p>
              <div className="space-y-2">
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm flex justify-between"><span>Readings Today</span><span className="font-bold text-slate-900">{readingsToday}</span></div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm flex justify-between"><span>Alerts Today</span><span className="font-bold text-rose-700">{alertsToday}</span></div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm flex justify-between"><span>Recovery Score</span><span className="font-bold text-indigo-700">{recoveryScore}/100</span></div>
              </div>
            </div>

            <section className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-2">Connection</p>
              {!patientName.trim() || !patientDetails.trim() ? (
                <p className="mb-2 rounded-lg bg-yellow-50 border border-yellow-200 px-2 py-1 text-[11px] text-yellow-800">Patient info required before Connect.</p>
              ) : null}
              <div className="space-y-2">
                <input
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm"
                  placeholder="Channel ID"
                  value={channelIdInput}
                  onChange={(event) => setChannelIdInput(event.target.value)}
                />
                <input
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm"
                  placeholder="Read API Key"
                  value={readApiKeyInput}
                  onChange={(event) => setReadApiKeyInput(event.target.value)}
                />
                <input
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm"
                  type="number"
                  min={5}
                  placeholder="Refresh Seconds"
                  value={refreshSecInput}
                  onChange={(event) => setRefreshSecInput(event.target.value)}
                />
                <button
                  disabled={!patientName.trim() || !patientDetails.trim()}
                  className="w-full bg-slate-900 text-white rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800 transition"
                  onClick={handleConnect}
                >
                  Connect
                </button>
              </div>
              {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
            </section>
          </aside>

          <main className="space-y-6">
            <section className="rounded-3xl border border-indigo-200 bg-gradient-to-br from-white via-indigo-50 to-sky-50 p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-700 mb-3">Patient Information & Report</p>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
                <input
                  type="text"
                  placeholder="Patient Name"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
                <input
                  type="text"
                  placeholder="Patient Details (Age, ID, etc.)"
                  value={patientDetails}
                  onChange={(e) => setPatientDetails(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
                <button
                  onClick={handleViewReport}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"
                >
                  View Report
                </button>
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <MetricCard
                title="Heart Rate"
                value={`${latestHr.toFixed(0)}`}
                unit="BPM"
                subtitle="Filtered + smoothed from Field 2"
                icon={<Activity size={20} />}
                progressColor="bg-rose-500"
                percent={(latestHr / 180) * 100}
              />
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
                title="Body Temperature"
                value={latestTemp === null ? "--" : `${latestTemp.toFixed(1)}°`}
                unit="Celsius"
                subtitle="MATLAB converted + smoothed Field 3"
                icon={<Thermometer size={20} />}
                progressColor="bg-emerald-500"
                percent={latestTemp === null ? 0 : (latestTemp / 45) * 100}
              />
              <article className="relative overflow-hidden rounded-2xl border border-cyan-200 bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 text-white shadow-sm p-6">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-200">AI Recovery Score</p>
                <p className="mt-4 text-4xl font-black tracking-tight">{recoveryScore}<span className="text-lg font-bold text-cyan-200">/100</span></p>
                <p className="mt-2 text-sm font-semibold text-cyan-100">{recoveryBand}</p>
                <div className="mt-4 h-2 w-full rounded-full bg-white/20 overflow-hidden">
                  <div className="h-full rounded-full bg-cyan-300" style={{ width: `${recoveryScore}%` }} />
                </div>
              </article>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <TrendCard
                title="Heart Rate"
                subTitle="Live trend • Field 2"
                options={hrOptions}
                series={hrSeries}
                type="area"
                height={235}
              />
              <TrendCard
                title="SpO2"
                subTitle="Live trend • Field 1"
                options={spo2Options}
                series={spo2Series}
                type="line"
                height={235}
              />
              <TrendCard
                title="Body Temperature"
                subTitle="Live trend • Field 3"
                options={tempOptions}
                series={tempSeries}
                type="line"
                height={235}
              />
              <TrendCard
                title="Combined Vitals"
                subTitle="SpO2 + BPM + Temp"
                options={combinedOptions}
                series={combinedSeries}
                type="line"
                height={235}
              />
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-4">
                <p className="text-sm font-extrabold uppercase tracking-[0.14em] text-slate-700">Alert Log</p>
                <p className="text-xs text-slate-500">{alertsToday} active alerts</p>
              </div>
              {activeAlerts.length ? (
                <ul className="space-y-2">
                  {activeAlerts.map((alert, idx) => (
                    <li key={idx} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                      {alert}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">No alerts - all vitals are within normal range.</p>
              )}
            </section>

            <section className="rounded-2xl border border-slate-300 bg-slate-100 p-4 md:p-5">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-700 mb-2">Critical Danger Thresholds (Fixed Clinical Defaults)</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm text-slate-800">
                <p className="rounded-lg border border-slate-300 bg-white px-3 py-2">SpO2 Danger: below {DANGER_LIMITS.spo2Low}%</p>
                <p className="rounded-lg border border-slate-300 bg-white px-3 py-2">HR Danger: above {DANGER_LIMITS.hrHigh} BPM</p>
                <p className="rounded-lg border border-slate-300 bg-white px-3 py-2">Temp Danger: above {DANGER_LIMITS.tempHigh} deg C</p>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
};

export default App;
