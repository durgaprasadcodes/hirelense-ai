import { useRef, useState, useMemo, useCallback } from "react";
import api from "../api/api";
import { useAuth } from "../auth/AuthContext";
import Navbar from "../components/Navbar";
import uploadResumeImage from "../assets/upload_resume.png";
import AtsScoreCircle from "../components/AtsScoreCircle";
import LoadingAnimation4 from "../anim/LoadingAnimation4";
import { showSuccess, showError } from "../lib/toast";
import { saveAnalysis, loadAnalysis, clearAnalysis } from "../lib/analysisStorage";
import "../styles/Analysis.css";

import {
    Chart as ChartJS,
    ArcElement,
    Tooltip,
    Legend,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Filler,
    Title,
} from "chart.js";
import { Doughnut, Line } from "react-chartjs-2";

ChartJS.register(
    ArcElement, Tooltip, Legend, CategoryScale, LinearScale,
    PointElement, LineElement, Filler, Title
);

// ============================================================================
// CONSTANTS & HELPERS
// ============================================================================

const ATS_CATEGORIES = [
    { key: "technical_skills", label: "Technical skills" },
    { key: "experience", label: "Experience" },
    { key: "projects", label: "Projects" },
    { key: "education", label: "Education" },
    { key: "keywords", label: "Keywords" },
];

// Score tiers, checked from highest to lowest
const TIERS = [
    {
        min: 80,
        label: "Excellent Match",
        tone: "tone-excellent",
        description:
            "Exceptional alignment with target technical roles. Core competencies, project depth and professional standards are clearly validated.",
    },
    {
        min: 65,
        label: "Strong Match",
        tone: "tone-strong",
        description:
            "Solid foundational alignment with key requirements. Closing keyword gaps and quantifying project outcomes will move you into top candidate pools.",
    },
    {
        min: 50,
        label: "Moderate Match",
        tone: "tone-moderate",
        description:
            "Relevant qualifications detected, but gaps remain in tech stack coverage, quantified outcomes and structured experience.",
    },
    {
        min: 0,
        label: "Needs Improvement",
        tone: "tone-risk",
        description:
            "Significant gaps against standard ATS parsing benchmarks. Structural reorganization, skill alignment and project depth need attention.",
    },
];

const getTier = (score) => TIERS.find((t) => score >= t.min);

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const asArray = (value) => (Array.isArray(value) ? value : []);

// Accepts a number or text like "85/100" and returns 0–100, or null if invalid
function parseAtsScore(value) {
    const raw =
        typeof value === "number"
            ? value
            : Number.parseInt(String(value ?? "").match(/\d{1,3}/)?.[0], 10);
    return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : null;
}

const getProjectScore = (p) => p?.final_score ?? p?.projects?.score ?? 0;

// Vertical gradient for the line-chart fill
function makeGradient(ctx, chartArea) {
    if (!chartArea) return "rgba(34, 211, 238, 0.45)";
    const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, "rgba(34, 211, 238, 0.45)");
    g.addColorStop(1, "rgba(34, 211, 238, 0.00)");
    return g;
}

const TOOLTIP_STYLE = {
    backgroundColor: "rgba(2, 6, 23, 0.92)",
    titleColor: "#e2e8f0",
    bodyColor: "#f8fafc",
    borderColor: "rgba(34, 211, 238, 0.35)",
    borderWidth: 1,
    padding: 12,
    cornerRadius: 10,
};

const DOUGHNUT_OPTIONS = (matchedCount, missingCount) => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: "74%",
    animation: { animateRotate: true, duration: 1100 },
    plugins: {
        legend: { display: false },
        tooltip: {
            ...TOOLTIP_STYLE,
            callbacks: {
                label: (ctx) => {
                    const total = matchedCount + missingCount;
                    const pct = total > 0 ? Math.round((ctx.raw / total) * 100) : 0;
                    return ` ${ctx.label}: ${ctx.raw} (${pct}%)`;
                },
            },
        },
    },
});

const LINE_OPTIONS = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    animation: { duration: 1200, easing: "easeOutQuart" },
    scales: {
        y: {
            beginAtZero: true,
            max: 100,
            grid: { color: "rgba(148, 163, 184, 0.08)", drawTicks: false },
            border: { display: false },
            ticks: {
                stepSize: 20,
                color: "#64748b",
                font: { family: "'JetBrains Mono', monospace", size: 11 },
                padding: 10,
            },
        },
        x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
                color: "#94a3b8",
                font: { family: "'Space Grotesk', sans-serif", size: 12, weight: "500" },
            },
        },
    },
    plugins: {
        legend: {
            display: true,
            position: "bottom",
            labels: {
                color: "#94a3b8",
                usePointStyle: true,
                boxWidth: 8,
                font: { family: "'Space Grotesk', sans-serif", size: 12 },
            },
        },
        tooltip: {
            ...TOOLTIP_STYLE,
            displayColors: false,
            callbacks: {
                label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw} / 100`,
            },
        },
    },
};

// ============================================================================
// SMALL UI COMPONENTS
// ============================================================================

// Card that tilts toward the cursor for a subtle 3D effect
function TiltCard({ children, className = "", intensity = 8 }) {
    const ref = useRef(null);

    const setVars = (vars) => {
        const el = ref.current;
        if (!el) return;
        Object.entries(vars).forEach(([name, value]) => el.style.setProperty(name, value));
    };

    const handleMove = (e) => {
        const rect = ref.current.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        setVars({
            "--ry": `${px * intensity}deg`,
            "--rx": `${-py * intensity}deg`,
            "--mx": `${(px + 0.5) * 100}%`,
            "--my": `${(py + 0.5) * 100}%`,
        });
    };

    const handleLeave = () => setVars({ "--ry": "0deg", "--rx": "0deg" });

    return (
        <div
            ref={ref}
            className={`tilt-card ${className}`}
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
        >
            <div className="tilt-inner">{children}</div>
        </div>
    );
}

function StatCard({ icon, label, value, subtext, accent }) {
    return (
        <TiltCard className={`kpi-card accent-${accent}`}>
            <div className="kpi-icon">
                <i className={icon} aria-hidden="true" />
            </div>
            <span className="kpi-label">{label}</span>
            <span className="kpi-value">{value}</span>
            {subtext && <span className="kpi-subtext">{subtext}</span>}
        </TiltCard>
    );
}

function Section({ eyebrow, title, icon, action, children }) {
    return (
        <section className="dash-section glass">
            <div className="section-header">
                <div>
                    {eyebrow && <span className="section-eyebrow">{eyebrow}</span>}
                    <h3 className="section-title">
                        {icon && <i className={`${icon} section-title-icon`} aria-hidden="true" />}
                        {title}
                    </h3>
                </div>
                {action && <div className="section-action">{action}</div>}
            </div>
            {children}
        </section>
    );
}

function EmptyState({ icon = "fa-solid fa-inbox", title, message }) {
    return (
        <div className="empty-state">
            <div className="empty-icon">
                <i className={icon} aria-hidden="true" />
            </div>
            <h4 className="empty-title">{title}</h4>
            <p className="empty-message">{message}</p>
        </div>
    );
}

function ProjectCard({ project, index }) {
    const data = project?.projects || {};
    const score = getProjectScore(project);

    return (
        <TiltCard className="project-card" intensity={6}>
            <div className="project-card-header">
                <div className="project-title-area">
                    <span className="project-index">{String(index + 1).padStart(2, "0")}</span>
                    <h4 className="project-name">{data.name || "Untitled Project"}</h4>
                </div>
                <div className={`score-ring ${getTier(score).tone}`}>
                    <span className="score-num">{score}</span>
                </div>
            </div>

            {data.description && (
                <div className="project-block">
                    <span className="block-label">Overview & Architecture</span>
                    <p className="block-text">{data.description}</p>
                </div>
            )}

            {data.project_value && (
                <div className="project-block project-value">
                    <span className="block-label">
                        <i className="fa-solid fa-chart-line" /> Why This Project Matters
                    </span>
                    <p className="block-text">{data.project_value}</p>
                </div>
            )}
        </TiltCard>
    );
}

const PRIORITY_ICONS = {
    high: "fa-solid fa-circle-exclamation",
    medium: "fa-solid fa-triangle-exclamation",
    low: "fa-solid fa-circle-info",
};

function RecommendationCard({ improvement, index }) {
    const priority = (improvement?.priority || "MEDIUM").toUpperCase();
    const level = priority === "HIGH" ? "high" : priority === "LOW" ? "low" : "medium";

    return (
        <TiltCard className={`rec-card rec-${level}`} intensity={4}>
            <div className="rec-top">
                <div className="rec-badges">
                    <span className={`rec-priority rec-${level}`}>
                        <i className={PRIORITY_ICONS[level]} /> {priority}
                    </span>
                    {improvement?.area && (
                        <span className="rec-area">
                            <i className="fa-solid fa-folder" /> {improvement.area}
                        </span>
                    )}
                </div>
                <span className="rec-step">STEP {String(index + 1).padStart(2, "0")}</span>
            </div>

            <h4 className="rec-problem">{improvement?.problem || "Identified Opportunity"}</h4>

            {improvement?.reason && (
                <div className="rec-reason">
                    <span className="rec-reason-label">Impact Analysis</span>
                    <p>{improvement.reason}</p>
                </div>
            )}
        </TiltCard>
    );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function Analysis() {
    const { user } = useAuth();
    const [saved] = useState(() => loadAnalysis()); // restore report after refresh

    const [file, setFile] = useState(null);
    const [jd, setJd] = useState("");
    const [dragActive, setDragActive] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [filename, setFilename] = useState(saved?.filename || "");
    const [filepath, setFilepath] = useState(saved?.filepath || "");
    const [result, setResult] = useState(saved?.result || null);
    const [ats, setAts] = useState(saved?.ats || null);
    const [error, setError] = useState("");

    const fileInputRef = useRef(null);

    const showErr = (msg) => {
        setError(msg);
        showError(msg);
    };

    // ---------------- FILE HANDLERS ----------------
    const acceptFile = useCallback((f) => {
        if (f?.name?.toLowerCase().endsWith(".pdf")) {
            setFile(f);
            setError("");
        } else {
            showErr("Please upload a PDF file.");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
        if (e.type === "dragleave") setDragActive(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        acceptFile(e.dataTransfer.files?.[0]);
    };

    const removeFile = () => {
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const handleReset = () => {
        setResult(null);
        setAts(null);
        setFile(null);
        setJd("");
        setError("");
        setFilename("");
        setFilepath("");
        clearAnalysis();
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const handleDownload = async () => {
        if (!filepath) return;
        setDownloading(true);
        try {
            const response = await fetch(filepath);
            if (!response.ok) throw new Error(`Download failed (${response.status}).`);

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename || "Resume.pdf";
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
            console.error("Resume download error:", err);
            showError("Could not download the resume. Please try again.");
        } finally {
            setDownloading(false);
        }
    };

    // ---------------- ANALYZE ----------------
    const handleAnalyze = async () => {
        if (!file) return setError("Please select a resume file first.");
        if (!jd.trim()) return showErr("Please enter the target job description.");
        if (!user?.id) return showErr("Your session could not be verified. Please sign in again.");

        setError("");
        setUploading(true);

        try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("jd", jd.trim());

            const { data } = await api.post("/hirelense/upload_resume", formData, {
                params: { user_id: user.id },
            });

            const parsed = typeof data.result === "string" ? JSON.parse(data.result) : data.result;
            const newFilename = data.filename || file.name || "Resume.pdf";
            const newFilepath = data.url || "";
            const newAts = data.ats || null;

            setResult(parsed);
            setAts(newAts);
            setFilename(newFilename);
            setFilepath(newFilepath);

            // Persist so the report survives a refresh (cleared on logout)
            saveAnalysis({ result: parsed, ats: newAts, filename: newFilename, filepath: newFilepath });

            showSuccess("Resume analyzed successfully!");
        } catch (err) {
            console.error("Resume analysis error:", err);
            showErr(err.response?.data?.detail || err.message || "Analysis failed. Please try again.");
        } finally {
            setUploading(false);
        }
    };

    // ---------------- DERIVED DATA ----------------
    const atsScore = parseAtsScore(ats?.overall_score ?? result?.ats_score) ?? 0;
    const tier = getTier(atsScore);

    const atsCategories = useMemo(() => {
        if (!ats?.breakdown) return [];
        return ATS_CATEGORIES.map(({ key, label }) => ({
            label,
            score: Number(ats.breakdown[key]),
        })).filter(({ score }) => Number.isFinite(score));
    }, [ats]);

    const matchedSkills = useMemo(() => asArray(result?.skills?.matched), [result]);
    const unmatchedSkills = useMemo(() => asArray(result?.skills?.unmatched), [result]);
    const skillScore = result?.skills?.final_score ?? (matchedSkills.length > 0 ? 100 : 0);

    const projectsList = useMemo(() => asArray(result?.projects), [result]);
    const projectScores = useMemo(() => projectsList.map(getProjectScore), [projectsList]);
    const projectAverage = useMemo(
        () =>
            projectScores.length
                ? Math.round(projectScores.reduce((a, b) => a + b, 0) / projectScores.length)
                : 0,
        [projectScores]
    );

    const certificationsList = useMemo(
        () => asArray(result?.certifications?.certificates),
        [result]
    );
    const certScore = result?.certifications?.final_score ?? 0;
    const experienceList = useMemo(() => asArray(result?.experience), [result]);
    const positivesList = useMemo(() => asArray(result?.resume_quality?.positives), [result]);
    const negativesList = useMemo(() => asArray(result?.resume_quality?.negatives), [result]);
    const improvementsList = useMemo(() => asArray(result?.improvements), [result]);

    // ---------------- CHART DATA ----------------
    const doughnutData = useMemo(() => {
        const matched = matchedSkills.length;
        const missing = unmatchedSkills.length;
        const empty = matched + missing === 0;
        return {
            labels: ["Matched", "Missing"],
            datasets: [
                {
                    data: empty ? [1, 0] : [matched, missing],
                    backgroundColor: empty ? ["#1e293b", "#1e293b"] : ["#22d3ee", "#f43f5e"],
                    borderColor: "#0b1120",
                    borderWidth: 4,
                    hoverOffset: 6,
                },
            ],
        };
    }, [matchedSkills, unmatchedSkills]);

    const doughnutOptions = useMemo(
        () => DOUGHNUT_OPTIONS(matchedSkills.length, unmatchedSkills.length),
        [matchedSkills, unmatchedSkills]
    );

    const projectLineData = useMemo(() => {
        const labels = projectsList.map((p, i) => {
            const name = p?.projects?.name || `Project ${i + 1}`;
            return name.length > 18 ? name.slice(0, 16) + "…" : name;
        });
        return {
            labels,
            datasets: [
                {
                    label: "Project score",
                    data: projectScores,
                    borderColor: "#22d3ee",
                    borderWidth: 3,
                    tension: 0.42,
                    fill: true,
                    backgroundColor: (ctx) => makeGradient(ctx.chart.ctx, ctx.chart.chartArea),
                    pointBackgroundColor: "#0b1120",
                    pointBorderColor: "#22d3ee",
                    pointBorderWidth: 2,
                    pointRadius: 5,
                    pointHoverRadius: 8,
                    pointHoverBackgroundColor: "#22d3ee",
                },
                {
                    label: "Average",
                    data: projectScores.map(() => projectAverage),
                    borderColor: "rgba(168, 85, 247, 0.8)",
                    borderDash: [6, 6],
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0,
                    fill: false,
                },
            ],
        };
    }, [projectsList, projectScores, projectAverage]);

    // ---------------- RENDER: LOADING ----------------
    if (uploading) {
        return (
            <>
                <Navbar />
                <div className="page-container analysis-page">
                    <Ambient />
                    <section className="analysis-loading-section" aria-live="polite">
                        <div className="analysis-loading-card">
                            <LoadingAnimation4 width={300} height={300} />
                            <div className="analysis-loading-copy">
                                <span className="hero-eyebrow">AI PARSER ACTIVE</span>
                                <h2 className="loading-title">Analyzing Your Resume…</h2>
                                <p className="loading-subtitle">
                                    Our AI engine is extracting keywords, evaluating ATS compatibility, and calculating your score.
                                </p>
                                <div className="loading-steps-pills">
                                    <span className="loading-step-pill active">
                                        <span className="step-live-dot" /> {file?.name || "Document.pdf"}
                                    </span>
                                    <span className="loading-step-pill">
                                        <i className="fa-solid fa-wand-magic-sparkles" /> Hirelense AI
                                    </span>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </>
        );
    }

    // ---------------- RENDER: UPLOAD ----------------
    if (!result) {
        return (
            <>
                <Navbar />
                <div className="page-container analysis-page">
                    <Ambient />
                    <section className="upload-section">
                        <span className="hero-eyebrow">AI · ATS INTELLIGENCE</span>
                        <h1 className="upload-title">
                            Upload your <span className="gradient-text">resume</span>
                        </h1>
                        <p className="upload-sub">
                            Get a full ATS breakdown, keyword gap analysis and prioritized career recommendations in seconds.
                        </p>

                        <div className="upload-workbench">
                            <div className="workbench-col resume-col">
                                <TiltCard className="dropzone-wrap" intensity={5}>
                                    <div
                                        className={`upload-dropzone${dragActive ? " is-active" : ""}`}
                                        onDragEnter={handleDrag}
                                        onDragLeave={handleDrag}
                                        onDragOver={handleDrag}
                                        onDrop={handleDrop}
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <img
                                            className="upload-illustration"
                                            src={uploadResumeImage}
                                            alt="Resume upload illustration"
                                        />
                                        <div className="dropzone-copy">
                                            <h3>{dragActive ? "Drop it like it's hot" : "Drag & drop your resume"}</h3>
                                            <p>or click to browse · PDF only · max 10MB</p>
                                        </div>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept=".pdf"
                                            hidden
                                            onChange={(e) => acceptFile(e.target.files?.[0])}
                                        />
                                    </div>
                                </TiltCard>

                                {file && (
                                    <div className="file-chip">
                                        <span>
                                            <i className="fa-regular fa-file-pdf" /> {file.name}{" "}
                                            <small>({(file.size / 1024).toFixed(1)} KB)</small>
                                        </span>
                                        <button type="button" onClick={removeFile}>
                                            <i className="fa-solid fa-xmark" /> Remove
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="workbench-col jd-col">
                                <div className="jd-input-container">
                                    <div className="jd-input-header">
                                        <label htmlFor="jd-textarea" className="jd-input-title">
                                            <i className="fa-solid fa-briefcase" /> Target Job Description
                                            <span className="jd-optional-tag">Required</span>
                                        </label>
                                        {jd && (
                                            <button type="button" className="jd-clear-btn" onClick={() => setJd("")}>
                                                Clear
                                            </button>
                                        )}
                                    </div>
                                    <textarea
                                        id="jd-textarea"
                                        className="jd-textarea"
                                        rows={6}
                                        placeholder="Paste the target Job Description (JD) here to evaluate your keyword match, skills alignment, and role relevancy..."
                                        value={jd}
                                        onChange={(e) => setJd(e.target.value)}
                                    />
                                    <div className="jd-input-footer">
                                        <span className="jd-char-counter">{jd.length.toLocaleString()} characters</span>
                                        <span className="jd-input-hint">
                                            <i className="fa-regular fa-lightbulb" /> Tip: Tailors ATS score & missing keywords.
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {error && <div className="error-banner">{error}</div>}

                        <button type="button" className="cta-btn" onClick={handleAnalyze} disabled={!file}>
                            <i className="fa-solid fa-bolt" /> Analyze Resume
                        </button>
                    </section>
                </div>
            </>
        );
    }

    // ---------------- RENDER: DASHBOARD ----------------
    return (
        <>
            <Navbar />
            <div className="page-container analysis-page">
                <Ambient />
                <div className="analysis-dashboard">
                    {/* HEADER */}
                    <header className="dash-header glass">
                        <div className="header-left">
                            <div className="header-eyebrow">
                                <span className="pill pill-cyan">RESUME ANALYSIS</span>
                                <span className="live">
                                    <span className="live-dot" /> AI Evaluated
                                </span>
                            </div>
                            <h1 className="header-title">
                                Resume <span className="gradient-text">Intelligence</span> Report
                            </h1>
                            <div className="candidate-meta">
                                <span className="candidate-name">{result?.name || "Candidate Profile"}</span>
                                {result?.profession && (
                                    <>
                                        <span className="sep">/</span>
                                        <span className="candidate-role">{result.profession}</span>
                                    </>
                                )}
                            </div>
                            <div className="file-tag">
                                <i className="fa-regular fa-file-pdf" /> {filename || "Resume.pdf"}
                            </div>
                        </div>

                        <div className="header-actions">
                            <button type="button" className="btn-ghost" onClick={handleReset}>
                                <i className="fa-solid fa-arrow-left" /> New analysis
                            </button>
                            <button type="button" className="btn-ghost" onClick={() => window.print()}>
                                <i className="fa-solid fa-print" /> Export
                            </button>
                            {filepath && (
                                <button type="button" className="btn-solid" onClick={handleDownload} disabled={downloading}>
                                    {downloading ? "Downloading…" : "Download PDF"}
                                </button>
                            )}
                        </div>
                    </header>

                    {/* HERO */}
                    <section className={`dash-hero glass ${tier.tone}`}>
                        <div className="hero-ring">
                            <AtsScoreCircle score={atsScore} size={200} strokeWidth={16} />
                        </div>
                        <div className="hero-copy">
                            <span className="hero-kicker">OVERALL EVALUATION</span>
                            <span className={`status-chip ${tier.tone}`}>
                                <i className="fa-solid fa-circle-check" /> {tier.label}
                            </span>
                            <h2 className="hero-heading">ATS Compatibility Score</h2>
                            <div className="hero-score">
                                <span className="hero-big">{atsScore}</span>
                                <span className="hero-denom">/100</span>
                            </div>
                            <p className="hero-desc">{tier.description}</p>
                        </div>
                    </section>

                    {/* ATS BREAKDOWN */}
                    {atsCategories.length > 0 && (
                        <Section eyebrow="SCORE DETAILS" title="ATS Score Breakdown" icon="fa-solid fa-chart-simple">
                            <div className="ats-breakdown-grid">
                                {atsCategories.map(({ label, score }) => (
                                    <div className="ats-breakdown-item" key={label}>
                                        <div className="ats-breakdown-heading">
                                            <span>{label}</span>
                                            <strong>{score}/100</strong>
                                        </div>
                                        <div
                                            className="ats-breakdown-track"
                                            role="progressbar"
                                            aria-label={`${label} score`}
                                            aria-valuemin={0}
                                            aria-valuemax={100}
                                            aria-valuenow={clamp(score, 0, 100)}
                                        >
                                            <div className="ats-breakdown-fill" style={{ width: `${clamp(score, 0, 100)}%` }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* KPIs */}
                    <section className="kpi-grid">
                        <StatCard icon="fa-solid fa-bullseye" label="ATS Score" value={`${atsScore}/100`} subtext={tier.label} accent="cyan" />
                        <StatCard
                            icon="fa-solid fa-chart-pie"
                            label="Skill Match"
                            value={`${skillScore}%`}
                            subtext={`${matchedSkills.length} matched · ${unmatchedSkills.length} missing`}
                            accent="emerald"
                        />
                        <StatCard
                            icon="fa-solid fa-code"
                            label="Project Score"
                            value={projectsList.length ? `${projectAverage}/100` : "N/A"}
                            subtext={`${projectsList.length} technical projects`}
                            accent="violet"
                        />
                        <StatCard
                            icon="fa-solid fa-certificate"
                            label="Certifications"
                            value={certificationsList.length}
                            subtext={certScore > 0 ? `Rating ${certScore}/100` : "Verified credentials"}
                            accent="amber"
                        />
                        <StatCard
                            icon="fa-solid fa-briefcase"
                            label="Experience"
                            value={experienceList.length}
                            subtext={experienceList.length ? "Track record" : "None detected"}
                            accent="rose"
                        />
                    </section>

                    {/* SKILLS */}
                    <Section
                        eyebrow="COMPETENCY BENCHMARK"
                        title="Skills Match"
                        icon="fa-solid fa-microchip"
                        action={<span className="pill">{matchedSkills.length} of {matchedSkills.length + unmatchedSkills.length}</span>}
                    >
                        <div className="skills-layout">
                            <TiltCard className="donut-card" intensity={6}>
                                <div className="donut-wrap">
                                    <Doughnut data={doughnutData} options={doughnutOptions} />
                                    <div className="donut-center">
                                        <span className="donut-num">{skillScore}%</span>
                                        <span className="donut-label">Match</span>
                                    </div>
                                </div>
                                <div className="donut-legend">
                                    <div><i className="dot dot-cyan" /> Matched <b>{matchedSkills.length}</b></div>
                                    <div><i className="dot dot-rose" /> Missing <b>{unmatchedSkills.length}</b></div>
                                </div>
                            </TiltCard>

                            <div className="skill-lists">
                                <div className="skill-group">
                                    <div className="group-title ok">
                                        <i className="fa-solid fa-circle-check" /> Matched ({matchedSkills.length})
                                    </div>
                                    {matchedSkills.length ? (
                                        <div className="chip-wrap">
                                            {matchedSkills.map((s, i) => (
                                                <span key={i} className="chip chip-ok">
                                                    <i className="fa-solid fa-check" /> {s}
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="muted-italic">No explicitly matched skills detected.</p>
                                    )}
                                </div>

                                <div className="skill-group">
                                    <div className="group-title bad">
                                        <i className="fa-solid fa-circle-exclamation" /> Missing ({unmatchedSkills.length})
                                    </div>
                                    {unmatchedSkills.length ? (
                                        <div className="chip-wrap">
                                            {unmatchedSkills.map((s, i) => (
                                                <span key={i} className="chip chip-bad">
                                                    <i className="fa-solid fa-xmark" /> {s}
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="all-clear">
                                            <i className="fa-solid fa-circle-check" /> No missing skills detected
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </Section>

                    {/* PROJECT CHART */}
                    <Section
                        eyebrow="PORTFOLIO RIGOR"
                        title="Project Performance"
                        icon="fa-solid fa-wave-square"
                        action={<span className="pill">Avg {projectAverage}/100</span>}
                    >
                        {projectsList.length > 0 ? (
                            <div className="line-chart-card">
                                <div className="line-chart-wrap">
                                    <Line data={projectLineData} options={LINE_OPTIONS} />
                                </div>
                            </div>
                        ) : (
                            <EmptyState
                                icon="fa-solid fa-laptop-code"
                                title="No projects detected"
                                message="No project sections were parsed. Quantified technical projects significantly improve ATS scoring."
                            />
                        )}
                    </Section>

                    {/* PROJECT CARDS */}
                    {projectsList.length > 0 && (
                        <Section eyebrow="DETAILED REPOSITORIES" title="Project Breakdown" icon="fa-solid fa-layer-group">
                            <div className="projects-grid">
                                {projectsList.map((p, i) => (
                                    <ProjectCard key={i} project={p} index={i} />
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* SUMMARY */}
                    <Section eyebrow="EXECUTIVE PROFILE" title="Professional Summary" icon="fa-solid fa-user-tie">
                        {result?.summary ? (
                            <p className="summary-text">{result.summary}</p>
                        ) : (
                            <EmptyState
                                icon="fa-solid fa-align-left"
                                title="No summary section found"
                                message="A concise professional summary highlighting your specialization is strongly recommended."
                            />
                        )}
                    </Section>

                    {/* CERTIFICATIONS */}
                    <Section
                        eyebrow="CREDENTIALS & BADGES"
                        title="Certifications"
                        icon="fa-solid fa-certificate"
                        action={certScore > 0 ? <span className="pill">Score {certScore}/100</span> : null}
                    >
                        {certificationsList.length > 0 ? (
                            <div className="cert-grid">
                                {certificationsList.map((c, i) => (
                                    <TiltCard key={i} className="cert-item" intensity={5}>
                                        <div className="cert-icon">
                                            <i className="fa-solid fa-award" />
                                        </div>
                                        <span>{c}</span>
                                    </TiltCard>
                                ))}
                            </div>
                        ) : (
                            <EmptyState
                                icon="fa-solid fa-award"
                                title="No certifications detected"
                                message="Industry-recognized credentials (AWS, Google Cloud, OCI, Scrum) can boost ATS ranking."
                            />
                        )}
                    </Section>

                    {/* EXPERIENCE */}
                    <Section eyebrow="CAREER HISTORY" title="Professional Experience" icon="fa-solid fa-briefcase">
                        {experienceList.length > 0 ? (
                            <div className="exp-list">
                                {experienceList.map((exp, i) => {
                                    const isObject = typeof exp === "object" && exp !== null;
                                    return (
                                        <TiltCard key={i} className="exp-item" intensity={4}>
                                            <div className="exp-marker">
                                                <i className="fa-solid fa-building" />
                                            </div>
                                            <div className="exp-body">
                                                <h4 className="exp-role">
                                                    {isObject ? exp.role || exp.title || "Role" : exp}
                                                </h4>
                                                {isObject && (exp.company || exp.duration) && (
                                                    <div className="exp-meta">
                                                        {exp.company && <span className="exp-company">{exp.company}</span>}
                                                        {exp.company && exp.duration && <span className="sep">·</span>}
                                                        {exp.duration && <span className="exp-duration">{exp.duration}</span>}
                                                    </div>
                                                )}
                                                {isObject && exp.description && <p className="exp-desc">{exp.description}</p>}
                                            </div>
                                        </TiltCard>
                                    );
                                })}
                            </div>
                        ) : (
                            <EmptyState
                                icon="fa-solid fa-briefcase"
                                title="No professional experience detected"
                                message="This resume emphasizes academic foundations, certifications and projects over corporate experience."
                            />
                        )}
                    </Section>

                    {/* QUALITY */}
                    <Section eyebrow="ATS AUDIT" title="Resume Quality" icon="fa-solid fa-scale-balanced">
                        <div className="quality-grid">
                            <TiltCard className="quality-card q-good" intensity={4}>
                                <div className="quality-head">
                                    <i className="fa-solid fa-circle-check" />
                                    <div>
                                        <h4>What Your Resume Does Well</h4>
                                        <span>Strong signals detected by parsing</span>
                                    </div>
                                </div>
                                {positivesList.length > 0 ? (
                                    <ul className="signal-list">
                                        {positivesList.map((item, i) => (
                                            <li key={i} className="signal good">
                                                <i className="fa-solid fa-check" />
                                                <span>{item}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="muted-italic">No specific positive signals highlighted.</p>
                                )}
                            </TiltCard>

                            <TiltCard className="quality-card q-warn" intensity={4}>
                                <div className="quality-head">
                                    <i className="fa-solid fa-triangle-exclamation" />
                                    <div>
                                        <h4>Potential Concerns</h4>
                                        <span>Red flags that could filter you out</span>
                                    </div>
                                </div>
                                {negativesList.length > 0 ? (
                                    <ul className="signal-list">
                                        {negativesList.map((item, i) => (
                                            <li key={i} className="signal bad">
                                                <i className="fa-solid fa-exclamation" />
                                                <span>{item}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div className="all-clear">
                                        <i className="fa-solid fa-shield-halved" /> No significant ATS red flags
                                    </div>
                                )}
                            </TiltCard>
                        </div>
                    </Section>

                    {/* IMPROVEMENTS */}
                    <Section
                        eyebrow="STRATEGIC ROADMAP"
                        title="Recommended Improvements"
                        icon="fa-solid fa-lightbulb"
                        action={improvementsList.length > 0 ? <span className="pill">{improvementsList.length} actions</span> : null}
                    >
                        {improvementsList.length > 0 ? (
                            <div className="rec-list">
                                {improvementsList.map((rec, i) => (
                                    <RecommendationCard key={i} improvement={rec} index={i} />
                                ))}
                            </div>
                        ) : (
                            <EmptyState
                                icon="fa-solid fa-award"
                                title="No immediate improvements necessary"
                                message="Your resume satisfies all primary criteria for the target role."
                            />
                        )}
                    </Section>
                </div>
            </div>
        </>
    );
}

// Decorative background glows used on every page state
function Ambient() {
    return (
        <>
            <div className="ambient ambient-a" aria-hidden="true" />
            <div className="ambient ambient-b" aria-hidden="true" />
        </>
    );
}
