import React, { useEffect, useState } from 'react';
import {
  ALLOWED_CATEGORIES,
  AllowedCategory,
  AnalysisProgress,
  ExecutionResult,
  OllamaStatus,
  OperationRecord,
  ReviewStatus,
  SanitizedClassification,
  ScannedFile,
  ScanResult,
  StagedItem
} from '../types.js';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function App(): React.JSX.Element {
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scannedFiles, setScannedFiles] = useState<ScannedFile[]>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Tab & Review State
  const [activeTab, setActiveTab] = useState<'review' | 'scanned' | 'history'>('review');
  const [stagedItems, setStagedItems] = useState<Map<string, StagedItem>>(new Map());
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'failed'>('all');

  // Edit Modal State
  const [editingItem, setEditingItem] = useState<StagedItem | null>(null);
  const [editFilename, setEditFilename] = useState<string>('');
  const [editCategory, setEditCategory] = useState<AllowedCategory>('Documents');
  const [editDestination, setEditDestination] = useState<string>('');

  // Stage D Execution & Undo State
  const [isConfirmingApply, setIsConfirmingApply] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [operationHistory, setOperationHistory] = useState<OperationRecord[]>([]);
  const [undoInProgressId, setUndoInProgressId] = useState<string | null>(null);
  const [undoFeedback, setUndoFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // 1. Check Ollama daemon status on mount
  useEffect(() => {
    let isMounted = true;
    async function checkOllama() {
      try {
        if (window.slothsort) {
          const status = await window.slothsort.getOllamaStatus();
          if (isMounted) setOllamaStatus(status);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setOllamaStatus({
            isHealthy: false,
            modelInstalled: false,
            modelName: 'gemma3:4b',
            error: String(err)
          });
        }
      }
    }

    checkOllama();
    const interval = setInterval(checkOllama, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // 2. Listen for real-time streaming scan progress
  useEffect(() => {
    if (!window.slothsort) return;

    const unsubScan = window.slothsort.onScanProgress((file: ScannedFile) => {
      setScannedFiles((prev) => {
        if (prev.some((f) => f.id === file.id)) return prev;
        return [...prev, file];
      });
    });

    const unsubProgress = window.slothsort.onAnalysisProgress((progress: AnalysisProgress) => {
      setAnalysisProgress(progress);
    });

    const unsubResult = window.slothsort.onAnalysisResult((item: StagedItem) => {
      setStagedItems((prev) => {
        const next = new Map(prev);
        next.set(item.id, item);
        return next;
      });
    });

    return () => {
      unsubScan();
      unsubProgress();
      unsubResult();
    };
  }, []);

  // Handle folder selection dialog
  const handleSelectFolder = async () => {
    try {
      setErrorMessage(null);
      const folderPath = await window.slothsort.selectFolder();
      if (!folderPath) return;

      setSelectedFolder(folderPath);
      setScannedFiles([]);
      setStagedItems(new Map());
      setAnalysisProgress(null);
      setScanResult(null);
      setIsScanning(true);

      const result = await window.slothsort.scanFolder(folderPath);
      setScanResult(result);
      setScannedFiles(result.files);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  // Re-scan current folder
  const handleRescan = async () => {
    if (!selectedFolder) return;
    try {
      setErrorMessage(null);
      setScannedFiles([]);
      setStagedItems(new Map());
      setAnalysisProgress(null);
      setScanResult(null);
      setIsScanning(true);

      const result = await window.slothsort.scanFolder(selectedFolder);
      setScanResult(result);
      setScannedFiles(result.files);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  // Trigger analysis for all discovered files
  const handleStartAnalysis = async () => {
    if (scannedFiles.length === 0) return;
    try {
      setErrorMessage(null);
      setActiveTab('review');
      const res = await window.slothsort.startAnalysis(scannedFiles);
      if (!res.started && res.error) {
        setErrorMessage(res.error);
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  // Cancel background queue
  const handleCancelAnalysis = async () => {
    try {
      await window.slothsort.cancelAnalysis();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  // Retry an individual failed item
  const handleRetryItem = async (fileId: string) => {
    try {
      await window.slothsort.retryAnalysis(fileId);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  // Update Review Status (Approve / Reject)
  const handleSetReviewStatus = async (fileId: string, status: ReviewStatus) => {
    try {
      await window.slothsort.updateReview(fileId, status);
      setStagedItems((prev) => {
        const item = prev.get(fileId);
        if (!item) return prev;
        const next = new Map(prev);
        next.set(fileId, { ...item, reviewStatus: status });
        return next;
      });
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (item: StagedItem) => {
    setEditingItem(item);
    const proposal = item.userEditedProposal || item.proposal;
    setEditFilename(proposal?.suggestedFilename || item.file.metadata.filename);
    setEditCategory(proposal?.category || 'Documents');
    setEditDestination(proposal?.proposedDestination || 'Documents');
  };

  // Save Edit Modal
  const handleSaveEdit = async () => {
    if (!editingItem) return;
    try {
      setErrorMessage(null);
      const customProposal: SanitizedClassification = {
        category: editCategory,
        suggestedFilename: editFilename.trim(),
        proposedDestination: editDestination.trim().replace(/\\/g, '/'),
        confidence: 'high',
        reasoning: 'User manually adjusted this suggestion.'
      };

      await window.slothsort.updateReview(editingItem.id, 'edited', customProposal);

      setStagedItems((prev) => {
        const item = prev.get(editingItem.id);
        if (!item) return prev;
        const next = new Map(prev);
        next.set(editingItem.id, {
          ...item,
          reviewStatus: 'edited',
          userEditedProposal: customProposal
        });
        return next;
      });

      setEditingItem(null);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  // Batch review actions
  const handleApproveAll = async () => {
    for (const item of stagedItems.values()) {
      if (item.analysisStatus === 'completed' && item.reviewStatus !== 'approved') {
        await window.slothsort.updateReview(item.id, 'approved');
      }
    }
    setStagedItems((prev) => {
      const next = new Map(prev);
      for (const [id, item] of next) {
        if (item.analysisStatus === 'completed') {
          next.set(id, { ...item, reviewStatus: 'approved' });
        }
      }
      return next;
    });
  };

  const handleRejectAll = async () => {
    for (const item of stagedItems.values()) {
      if (item.reviewStatus !== 'rejected') {
        await window.slothsort.updateReview(item.id, 'rejected');
      }
    }
    setStagedItems((prev) => {
      const next = new Map(prev);
      for (const [id, item] of next) {
        next.set(id, { ...item, reviewStatus: 'rejected' });
      }
      return next;
    });
  };

  const loadHistory = async () => {
    try {
      if (window.slothsort) {
        const history = await window.slothsort.getJournal(selectedFolder || undefined);
        setOperationHistory(history);
      }
    } catch {
      // ignore
    }
  };

  const handleConfirmExecute = async () => {
    if (!selectedFolder) return;
    const approvedItems = Array.from(stagedItems.values()).filter(
      (item) => item.reviewStatus === 'approved' && !item.appliedOperationId
    );
    if (approvedItems.length === 0) return;

    try {
      setIsExecuting(true);
      setErrorMessage(null);
      setIsConfirmingApply(false);

      const approvedIds = approvedItems.map((i) => i.id);
      const result = await window.slothsort.executeOperations(selectedFolder, approvedIds);
      setExecutionResult(result);

      await loadHistory();

      setStagedItems((prev) => {
        const next = new Map(prev);
        for (const op of result.successful) {
          const item = next.get(op.stagedItemId);
          if (item) {
            next.set(op.stagedItemId, {
              ...item,
              appliedOperationId: op.id
            });
          }
        }
        return next;
      });
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExecuting(false);
    }
  };

  const handleUndoOperation = async (operationId: string) => {
    try {
      setUndoInProgressId(operationId);
      setUndoFeedback(null);
      const res = await window.slothsort.undoOperation(operationId);
      if (res.success) {
        setUndoFeedback({ type: 'success', message: 'Operation successfully undone. File returned to original path.' });
        await loadHistory();
      } else {
        setUndoFeedback({ type: 'error', message: res.error || 'Undo failed.' });
      }
    } catch (err: unknown) {
      setUndoFeedback({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setUndoInProgressId(null);
    }
  };

  // Filtered lists
  const stagedList = Array.from(stagedItems.values());
  const filteredStaged = stagedList.filter((item) => {
    if (reviewFilter === 'pending') return item.reviewStatus === 'pending_review' && item.analysisStatus === 'completed';
    if (reviewFilter === 'approved') return item.reviewStatus === 'approved' || item.reviewStatus === 'edited';
    if (reviewFilter === 'rejected') return item.reviewStatus === 'rejected';
    if (reviewFilter === 'failed') return item.analysisStatus === 'failed';
    return true;
  });

  const filteredScanned = scannedFiles.filter((f) =>
    f.metadata.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.relativePath.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="app-container">
      {/* Editorial Header */}
      <header className="app-header">
        <div className="brand-section">
          <span className="brand-logo" role="img" aria-label="Sloth">🦥</span>
          <h1 className="brand-title">SlothSort</h1>
          <span className="brand-tagline">Slow and Steady</span>
        </div>

        <div className="header-status">
          {ollamaStatus ? (
            <div className="status-pill" title={ollamaStatus.error || 'Ollama daemon active'}>
              <span className={`status-dot ${ollamaStatus.isHealthy && ollamaStatus.modelInstalled ? 'online' : 'offline'}`} />
              <span>
                {ollamaStatus.isHealthy && ollamaStatus.modelInstalled
                  ? `${ollamaStatus.modelName} Ready`
                  : 'Ollama Offline / Model Missing'}
              </span>
            </div>
          ) : (
            <div className="status-pill">
              <span className="status-dot offline" />
              <span>Checking Ollama...</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-content">
        {/* Error Notification */}
        {errorMessage && (
          <div style={{
            padding: '12px 18px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '10px',
            color: '#fca5a5',
            fontSize: '13.5px',
            marginBottom: '20px'
          }}>
            <strong>Notice:</strong> {errorMessage}
          </div>
        )}

        {/* Folder Selection Banner */}
        <section className="folder-picker-card">
          <div className="folder-info">
            <span className="folder-label">Target Directory</span>
            <div className="folder-path" title={selectedFolder || 'No folder chosen'}>
              {selectedFolder || 'No folder selected — Click Choose Folder to begin'}
            </div>
          </div>
          <div className="folder-actions">
            <button
              className="btn btn-primary"
              onClick={handleSelectFolder}
              disabled={isScanning || (analysisProgress?.isRunning ?? false)}
            >
              {selectedFolder ? 'Change Folder...' : 'Choose Folder...'}
            </button>
            {selectedFolder && (
              <>
                <button
                  className="btn btn-secondary"
                  onClick={handleRescan}
                  disabled={isScanning || (analysisProgress?.isRunning ?? false)}
                >
                  {isScanning ? 'Scanning...' : 'Rescan'}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleStartAnalysis}
                  disabled={isScanning || scannedFiles.length === 0 || (analysisProgress?.isRunning ?? false)}
                  style={{ background: '#3b82f6', color: '#fff' }}
                >
                  ⚡ Start AI Analysis ({scannedFiles.length})
                </button>
              </>
            )}
          </div>
        </section>

        {/* Asynchronous Queue Progress Card */}
        {analysisProgress && (
          <section className="progress-card">
            <div className="progress-header">
              <span className="progress-title">
                {analysisProgress.isRunning && <span className="spinner" />}
                {analysisProgress.isRunning ? 'Analyzing Files Sequentially...' : 'Queue Completed / Paused'}
              </span>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                  {analysisProgress.processed} of {analysisProgress.total} processed ({analysisProgress.percent}%)
                </span>
                {analysisProgress.isRunning && (
                  <button className="btn btn-secondary btn-sm" onClick={handleCancelAnalysis}>
                    Cancel Queue
                  </button>
                )}
              </div>
            </div>

            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${analysisProgress.percent}%` }} />
            </div>

            <div className="progress-meta">
              <span>
                {analysisProgress.currentFilename
                  ? `Analyzing: ${analysisProgress.currentFilename}`
                  : 'Idle'}
              </span>
              <span>Local Model: {ollamaStatus?.modelName || 'gemma3:4b'} (CPU AVX2)</span>
            </div>
          </section>
        )}

        {/* Safety Banner */}
        <div className="safety-banner">
          <span className="safety-icon">🛡️</span>
          <div>
            <strong>Stage D: Approval-Gated Execution & Verifiable Undo.</strong> Only items you explicitly approve will be organized when clicking "Apply Approved Changes". No files will be overwritten or deleted. Full cryptographic rollback is supported via the Operation History journal.
          </div>
        </div>

        {/* Execution Summary Alert */}
        {executionResult && (
          <div className={`execution-summary ${executionResult.failed.length > 0 ? 'has-errors' : ''}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '14.5px', color: '#fff' }}>
                Batch Execution Completed
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setExecutionResult(null)}
              >
                Dismiss
              </button>
            </div>
            <div className="execution-counts">
              <span className="execution-count-item" style={{ color: '#6ee7b7' }}>
                ✓ Moved: {executionResult.successful.length}
              </span>
              <span className="execution-count-item" style={{ color: '#fca5a5' }}>
                ✗ Errors/Collisions: {executionResult.failed.length}
              </span>
              <span className="execution-count-item" style={{ color: '#cbd5e1' }}>
                ↷ Skipped: {executionResult.skipped.length}
              </span>
            </div>
            {executionResult.failed.length > 0 && (
              <div style={{ marginTop: '8px', fontSize: '12.5px', color: '#fca5a5' }}>
                {executionResult.failed.map((fail) => (
                  <div key={fail.itemId}>
                    • <strong>{fail.filename}:</strong> {fail.error}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab Navigation */}
        {selectedFolder && (
          <div className="tab-bar">
            <button
              className={`tab-btn ${activeTab === 'review' ? 'active' : ''}`}
              onClick={() => setActiveTab('review')}
            >
              <span>Staging & Review Queue</span>
              <span className="tab-counter">{stagedList.length}</span>
            </button>
            <button
              className={`tab-btn ${activeTab === 'scanned' ? 'active' : ''}`}
              onClick={() => setActiveTab('scanned')}
            >
              <span>Discovered Files (Raw Metadata)</span>
              <span className="tab-counter">{scannedFiles.length}</span>
            </button>
            <button
              className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('history');
                loadHistory();
              }}
            >
              <span>Operation History (Undo)</span>
              <span className="tab-counter">{operationHistory.length}</span>
            </button>
          </div>
        )}

        {/* TAB 1: Staging & Review Queue */}
        {activeTab === 'review' && (
          <section className="table-container">
            <div className="review-header-bar">
              <div className="filter-pills">
                <button
                  className={`filter-pill ${reviewFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setReviewFilter('all')}
                >
                  All ({stagedList.length})
                </button>
                <button
                  className={`filter-pill ${reviewFilter === 'pending' ? 'active' : ''}`}
                  onClick={() => setReviewFilter('pending')}
                >
                  Pending Review ({stagedList.filter((i) => i.reviewStatus === 'pending_review' && i.analysisStatus === 'completed').length})
                </button>
                <button
                  className={`filter-pill ${reviewFilter === 'approved' ? 'active' : ''}`}
                  onClick={() => setReviewFilter('approved')}
                >
                  Approved ({stagedList.filter((i) => i.reviewStatus === 'approved' || i.reviewStatus === 'edited').length})
                </button>
                <button
                  className={`filter-pill ${reviewFilter === 'rejected' ? 'active' : ''}`}
                  onClick={() => setReviewFilter('rejected')}
                >
                  Rejected ({stagedList.filter((i) => i.reviewStatus === 'rejected').length})
                </button>
                <button
                  className={`filter-pill ${reviewFilter === 'failed' ? 'active' : ''}`}
                  onClick={() => setReviewFilter('failed')}
                >
                  Failed ({stagedList.filter((i) => i.analysisStatus === 'failed').length})
                </button>
              </div>

              {stagedList.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button className="btn btn-secondary btn-sm" onClick={handleApproveAll}>
                    ✓ Approve All
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={handleRejectAll}>
                    ✕ Reject All
                  </button>
                  {(() => {
                    const approvedCount = stagedList.filter(
                      (i) => i.reviewStatus === 'approved' && !i.appliedOperationId
                    ).length;
                    return (
                      <button
                        className="btn btn-apply-batch"
                        onClick={() => setIsConfirmingApply(true)}
                        disabled={approvedCount === 0 || isExecuting}
                      >
                        {isExecuting ? 'Applying...' : `⚡ Apply Approved (${approvedCount})`}
                      </button>
                    );
                  })()}
                </div>
              )}
            </div>

            {stagedList.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">⏳</div>
                <h3 className="empty-title">Staging Queue is Empty</h3>
                <p className="empty-subtext">
                  {scannedFiles.length > 0
                    ? `You have ${scannedFiles.length} files discovered. Click "Start AI Analysis" above to queue them for classification.`
                    : 'Select a folder to discover files and begin organizing.'}
                </p>
                {scannedFiles.length > 0 && (
                  <button className="btn btn-primary" onClick={handleStartAnalysis}>
                    Start AI Analysis Now
                  </button>
                )}
              </div>
            ) : filteredStaged.length === 0 ? (
              <div className="empty-state">
                <p className="empty-subtext">No items match the selected filter ({reviewFilter}).</p>
              </div>
            ) : (
              <div className="staged-cards-list">
                {filteredStaged.map((item) => {
                  const effectiveProposal = item.userEditedProposal || item.proposal;
                  return (
                    <div key={item.id} className="staged-item-card">
                      <div className="staged-item-top">
                        <div className="file-transformation">
                          <div className="file-orig-name">
                            <span>📄</span>
                            <span>{item.file.metadata.filename}</span>
                            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                              ({formatBytes(item.file.metadata.sizeBytes)})
                            </span>
                          </div>

                          {effectiveProposal && item.analysisStatus === 'completed' && (
                            <div className="file-prop-name">
                              <span style={{ color: 'var(--accent-emerald)' }}>➔</span>
                              <span>{effectiveProposal.suggestedFilename}</span>
                              {item.reviewStatus === 'edited' && (
                                <span className="badge badge-amber">Custom Edited</span>
                              )}
                            </div>
                          )}

                          {item.analysisStatus === 'analyzing' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-blue)', fontSize: '13px' }}>
                              <span className="spinner" />
                              <span>Analyzing file with local Gemma 3 4B...</span>
                            </div>
                          )}

                          {item.analysisStatus === 'queued' && (
                            <div style={{ color: 'var(--text-dim)', fontSize: '12px' }}>
                              Queued for background analysis...
                            </div>
                          )}

                          {item.analysisStatus === 'cancelled' && (
                            <div style={{ color: 'var(--accent-amber)', fontSize: '12px' }}>
                              Cancelled before completion.
                            </div>
                          )}

                          {item.analysisStatus === 'failed' && (
                            <div style={{ color: 'var(--accent-rose)', fontSize: '12.5px' }}>
                              <strong>Error:</strong> {item.error || 'Classification failed.'}
                            </div>
                          )}
                        </div>

                        {/* User Action Controls */}
                        <div className="item-actions">
                          {item.appliedOperationId ? (
                            <span className="badge badge-emerald" style={{ padding: '6px 12px', fontSize: '12px' }}>
                              ✓ Applied & Organized
                            </span>
                          ) : item.analysisStatus === 'completed' ? (
                            <>
                              <button
                                className={`btn btn-sm btn-approve ${item.reviewStatus === 'approved' ? 'active' : ''}`}
                                onClick={() => handleSetReviewStatus(item.id, 'approved')}
                              >
                                ✓ Approve
                              </button>
                              <button
                                className={`btn btn-sm btn-reject ${item.reviewStatus === 'rejected' ? 'active' : ''}`}
                                onClick={() => handleSetReviewStatus(item.id, 'rejected')}
                              >
                                ✕ Reject
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleOpenEdit(item)}
                              >
                                ✎ Edit...
                              </button>
                            </>
                          ) : null}

                          {(item.analysisStatus === 'failed' || item.analysisStatus === 'cancelled') && (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleRetryItem(item.id)}
                            >
                              ↺ Retry
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Proposal Details (Category, Destination, Reasoning) */}
                      {effectiveProposal && item.analysisStatus === 'completed' && (
                        <>
                          <div className="staged-meta-row">
                            <span className="badge badge-emerald">
                              Category: {effectiveProposal.category}
                            </span>
                            <span className="dest-chip">
                              📁 Destination: {effectiveProposal.proposedDestination}
                            </span>
                            {item.latencyMs && (
                              <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                                Inference: {item.latencyMs}ms
                              </span>
                            )}
                          </div>

                          {effectiveProposal.reasoning && (
                            <div className="reasoning-box">
                              "{effectiveProposal.reasoning}"
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* TAB 2: Discovered Files (Raw Metadata) */}
        {activeTab === 'scanned' && (
          <section className="table-container">
            <div className="table-header-bar">
              <h2 className="table-title">
                Discovered Files ({filteredScanned.length} of {scannedFiles.length})
              </h2>
              <input
                type="text"
                className="search-input"
                placeholder="Filter files by name or path..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="file-table">
                <thead>
                  <tr>
                    <th>Filename & Relative Path</th>
                    <th>Size</th>
                    <th>Extension</th>
                    <th>Context Excerpt</th>
                    <th>Modified Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredScanned.map((file) => (
                    <tr key={file.id}>
                      <td>
                        <div className="file-name-cell">
                          <span className="file-icon">📄</span>
                          <div>
                            <div>{file.metadata.filename}</div>
                            {file.relativePath !== file.metadata.filename && (
                              <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                                {file.relativePath}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>
                        {formatBytes(file.metadata.sizeBytes)}
                      </td>
                      <td>
                        <span className="badge badge-gray">{file.metadata.extension || 'None'}</span>
                      </td>
                      <td>
                        {file.metadata.isSensitiveExcluded ? (
                          <span className="badge badge-amber" title={file.metadata.privacyNotice}>
                            🛡️ Sensitive: Excerpt Suppressed
                          </span>
                        ) : file.metadata.textExcerpt ? (
                          <span
                            className="badge badge-emerald"
                            title={file.metadata.textExcerpt}
                            style={{ maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            Excerpt: {file.metadata.textExcerpt.slice(0, 45)}...
                          </span>
                        ) : file.metadata.isScreenshotHint ? (
                          <span className="badge badge-amber">Screenshot Signal</span>
                        ) : (
                          <span style={{ color: 'var(--text-dim)', fontSize: '12px' }}>Binary / None</span>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                        {file.metadata.modifiedAt
                          ? new Date(file.metadata.modifiedAt).toLocaleDateString()
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* TAB 3: Operation History & Safe Undo */}
        {activeTab === 'history' && (
          <section className="undo-history-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>
                  Operation Journal & Safe Rollback
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Durable, append-only record of all file moves and renames performed by SlothSort.
                </p>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={loadHistory}>
                ↻ Refresh Journal
              </button>
            </div>

            {undoFeedback && (
              <div style={{
                padding: '12px 18px',
                borderRadius: '8px',
                background: undoFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                border: `1px solid ${undoFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                color: undoFeedback.type === 'success' ? '#6ee7b7' : '#fca5a5',
                fontSize: '13px'
              }}>
                {undoFeedback.message}
              </div>
            )}

            {operationHistory.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📜</div>
                <h3 className="empty-title">No Operations Recorded Yet</h3>
                <p className="empty-subtext">
                  Files you approve and apply in the Staging Queue will appear here with cryptographic rollback records.
                </p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Original File</th>
                      <th>Destination File</th>
                      <th>Category</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operationHistory.map((op) => (
                      <tr key={op.id}>
                        <td style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {new Date(op.timestamp).toLocaleString()}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{op.originalFilename}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{op.sourceRelativePath}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: '#6ee7b7' }}>{op.newFilename}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{op.destinationRelativePath}</div>
                        </td>
                        <td>
                          <span className="badge badge-purple">{op.category}</span>
                        </td>
                        <td>
                          {op.status === 'completed' && <span className="badge badge-emerald">✓ Completed</span>}
                          {op.status === 'undone' && <span className="badge badge-gray">↺ Rolled Back</span>}
                          {op.status === 'failed' && <span className="badge badge-rose" title={op.error}>✗ Failed</span>}
                          {op.status === 'undo_failed' && <span className="badge badge-rose" title={op.error}>✗ Undo Failed</span>}
                          {op.status === 'pending' && <span className="badge badge-amber">⏳ Pending</span>}
                          {op.status === 'undo_pending' && <span className="badge badge-amber">⏳ Undo Pending</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {op.status === 'completed' && (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleUndoOperation(op.id)}
                              disabled={undoInProgressId === op.id}
                            >
                              {undoInProgressId === op.id ? 'Rolling back...' : '↺ Undo Move'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Inline Proposal Edit Modal */}
        {editingItem && (
          <div className="modal-overlay" onClick={() => setEditingItem(null)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3 style={{ fontSize: '17px', fontWeight: 700, color: '#fff' }}>
                Edit Suggestion for {editingItem.file.metadata.filename}
              </h3>

              <div className="form-group">
                <label className="form-label">Suggested Filename</label>
                <input
                  type="text"
                  className="form-input"
                  value={editFilename}
                  onChange={(e) => setEditFilename(e.target.value)}
                  placeholder="e.g. Q4_Report.pdf"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Classification Category</label>
                <select
                  className="form-select"
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value as AllowedCategory)}
                >
                  {ALLOWED_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Proposed Destination Folder (Relative)</label>
                <input
                  type="text"
                  className="form-input"
                  value={editDestination}
                  onChange={(e) => setEditDestination(e.target.value)}
                  placeholder="e.g. Documents/Finance"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button className="btn btn-secondary" onClick={() => setEditingItem(null)}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleSaveEdit}>
                  Save & Apply Edit
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Batch Apply Confirmation Modal */}
        {isConfirmingApply && (
          <div className="modal-overlay" onClick={() => setIsConfirmingApply(false)}>
            <div className="modal-content" style={{ width: '680px' }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#fff' }}>
                Confirm File Organization Batch
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Review the approved moves below. SlothSort will move each file into its approved destination folder.
                No files will be deleted or overwritten. Any completed move can be safely rolled back in Operation History.
              </p>

              <div className="confirm-table-container">
                <table className="confirm-table">
                  <thead>
                    <tr>
                      <th>Original Filename</th>
                      <th>Category</th>
                      <th>Target Destination & Proposed Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stagedList
                      .filter((i) => i.reviewStatus === 'approved' && !i.appliedOperationId)
                      .map((item) => {
                        const p = item.userEditedProposal || item.proposal!;
                        return (
                          <tr key={item.id}>
                            <td style={{ fontWeight: 600 }}>{item.file.metadata.filename}</td>
                            <td>
                              <span className="badge badge-purple">{p.category}</span>
                            </td>
                            <td style={{ color: '#6ee7b7' }}>
                              {p.proposedDestination}/{p.suggestedFilename}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setIsConfirmingApply(false)}
                  disabled={isExecuting}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-apply-batch"
                  onClick={handleConfirmExecute}
                  disabled={isExecuting}
                >
                  {isExecuting ? 'Applying...' : 'Confirm & Apply All'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
