/**
 *
 * Adoption Details Dashboard Page
 *
 * @fileoverview Shows organization-level adoption metrics and form usage patterns
 * @author Nick Zipse <nick.zipse@rewst.com>
 * @version 1.3.3
 */

// Helper: Check if execution is a form submission
// Uses multiple sources because triggerInfo may be missing due to timeouts
function isFormSubmission(exec) {
  // Skip option generators regardless of trigger type
  if (exec.workflow?.type === 'OPTION_GENERATOR') return false;

  // 1. Try triggerInfo.type (primary source - most reliable)
  const triggerType = exec.triggerInfo?.type || exec.triggerInfo?.Type || '';
  const tLower = String(triggerType).toLowerCase();
  if (tLower === 'form submission') return true;

  // 2. Check for form-specific data even if type is missing/different
  // This catches cases where type timed out but form data exists
  if (exec.triggerInfo?.formId || exec.triggerInfo?.submittedInputs || exec.form?.id) {
    return true;
  }

  // 3. Check for Cron/Webhook signatures in conductor.input
  // This is reliable because conductor.input is always populated during initial fetch
  const conductorInput = exec.conductor?.input || {};
  const hasCronSignature = conductorInput.cron && conductorInput.timezone;
  const hasWebhookSignature = conductorInput.method && conductorInput.headers;
  if (hasCronSignature || hasWebhookSignature) return false;

  // 4. If triggerInfo.type exists and is NOT "form submission", trust it
  // This filters out Manual/Test, Cron Job, Webhook, App Platform, etc.
  if (triggerType && tLower !== '' && tLower !== 'form submission') return false;

  // 5. Fallback: Check if workflow has a Form Submission trigger with a formId
  // Used ONLY when triggerInfo.type is completely missing (timeout case)
  if (exec.workflow?.triggers) {
    const formTrigger = exec.workflow.triggers.find(t =>
      (t.triggerType?.name === 'Form Submission' || t.triggerType?.ref?.includes('form')) &&
      t.formId // Must have a formId to be a real form submission trigger
    );
    if (formTrigger) return true;
  }

  return false;
}

// Helper: Get formId from execution with multiple fallback sources
// For managed orgs, triggerInfo.formId may be null - try workflow.triggers as fallback
function getFormId(exec) {
  // 1. Try triggerInfo.formId (from context fetch - may be null for managed orgs)
  if (exec.triggerInfo?.formId) return exec.triggerInfo.formId;

  // 2. Try form.id (legacy)
  if (exec.form?.id) return exec.form.id;

  // 3. Fallback: get formId from workflow's Form Submission trigger
  if (exec.workflow?.triggers) {
    const formTrigger = exec.workflow.triggers.find(t =>
      t.triggerType?.name === 'Form Submission' ||
      t.triggerType?.ref?.includes('form')
    );
    if (formTrigger?.formId) return formTrigger.formId;
  }

  return null;
}

// Helper: Get form name with fallback to dashboardData.forms lookup
// When trigger info times out (common with 175+ managed orgs), formName is missing
// Use the forms cache (loaded in Phase 1) as fallback
function getFormName(exec) {
  // 1. Check for async-resolved form name (from fetchMissingFormNames)
  if (exec._resolvedFormName) {
    return exec._resolvedFormName;
  }

  // 2. Try triggerInfo.formName (populated by library when trigger info succeeds)
  if (exec.triggerInfo?.formName) {
    return exec.triggerInfo.formName;
  }

  // 3. Fallback: lookup from dashboardData.forms using formId (with multiple fallback sources)
  const formId = getFormId(exec);
  if (formId && window.dashboardData?.forms) {
    const form = window.dashboardData.forms.find(f => f.id === formId);
    if (form?.name) return form.name;
  }

  // 4. Final fallback: use workflow name (forms from managed orgs aren't in parent's forms list)
  if (exec.workflow?.name) {
    return exec.workflow.name;
  }

  return 'Unknown Form';
}

function renderAdoptionDashboard() {
  console.log("📊 Rendering Adoption page");

  if (!window.dashboardData || !window.dashboardData.executions) {
    console.error("No dashboard data available");
    return;
  }

  const { executions } = window.dashboardData;
  const filteredExecutions = getFilteredExecutions();

  // Filter for form submissions only
  // Uses isFormSubmission() helper which checks both triggerInfo.type AND workflow.triggers
  // This catches form submissions even when triggerInfo times out
  const formExecutions = filteredExecutions.filter(isFormSubmission);

  // DEBUG: Log how executions were identified as form submissions
  const identifiedByTriggerInfo = formExecutions.filter(e => {
    const t = e.triggerInfo?.type || e.triggerInfo?.Type || '';
    return String(t).toLowerCase() === 'form submission';
  }).length;
  const identifiedByWorkflowTrigger = formExecutions.filter(e => {
    const t = e.triggerInfo?.type || e.triggerInfo?.Type || '';
    if (String(t).toLowerCase() === 'form submission') return false; // already counted
    return e.workflow?.triggers?.some(tr =>
      (tr.triggerType?.name === 'Form Submission' || tr.triggerType?.ref?.includes('form')) && tr.formId
    );
  }).length;
  console.log(`📊 Form submissions: ${formExecutions.length} total (${identifiedByTriggerInfo} via triggerInfo, ${identifiedByWorkflowTrigger} via workflow.triggers fallback)`);

  // DEBUG: Check for potential missed form submissions (have Form Submission trigger but no formId)
  const potentialMissed = filteredExecutions.filter(e => {
    if (isFormSubmission(e)) return false; // already counted
    if (e.workflow?.type === 'OPTION_GENERATOR') return false;
    return e.workflow?.triggers?.some(tr =>
      tr.triggerType?.name === 'Form Submission' || tr.triggerType?.ref?.includes('form')
    );
  });
  if (potentialMissed.length > 0) {
    console.log(`⚠️ Potential missed form submissions (Form Submission trigger but no formId): ${potentialMissed.length}`);
    console.log('Sample:', potentialMissed.slice(0, 3).map(e => ({
      workflow: e.workflow?.name,
      triggers: e.workflow?.triggers?.map(t => ({ name: t.triggerType?.name, formId: t.formId }))
    })));
  }

  console.log(`Adoption Dashboard: ${formExecutions.length} form submissions across filtered executions`);

  // ============================================================
  // CALCULATE ORG-LEVEL METRICS
  // ============================================================

  const orgStats = {};

  // Initialize ALL managed orgs with zero values (so they appear even with no submissions)
  const managedOrgs = window.dashboardData.managedOrgs || [];

  // DEBUG: Log trigger types found in the data
  const triggerTypeCounts = {};
  filteredExecutions.forEach(e => {
    const t = e.triggerInfo?.type || e.triggerInfo?.Type || '(no triggerInfo)';
    triggerTypeCounts[t] = (triggerTypeCounts[t] || 0) + 1;
  });
  console.log('📊 Adoption Debug - Trigger type breakdown:', triggerTypeCounts);
  console.log('📊 Adoption Debug - Total filtered executions:', filteredExecutions.length);
  console.log('📊 Adoption Debug - managedOrgs count:', managedOrgs.length);
  managedOrgs.forEach(org => {
    orgStats[org.name] = {
      name: org.name,
      id: org.id,
      formSubmissions: 0,
      timeSaved: 0,
      executions: 0,
      tasksUsed: 0,
      uniqueForms: new Set(),
      dailyActivity: {}
    };
  });

  // Now accumulate metrics from form executions
  formExecutions.forEach(exec => {
    const orgName = exec.organization?.name || exec.triggerInfo?.organization?.name || 'Unknown';

    // Create entry if not in managed orgs list (shouldn't happen, but safety fallback)
    if (!orgStats[orgName]) {
      orgStats[orgName] = {
        name: orgName,
        formSubmissions: 0,
        timeSaved: 0,
        executions: 0,
        tasksUsed: 0,
        uniqueForms: new Set(),
        dailyActivity: {}
      };
    }

    orgStats[orgName].formSubmissions++;
    orgStats[orgName].timeSaved += (exec.workflow?.humanSecondsSaved || 0);
    orgStats[orgName].executions++;
    orgStats[orgName].tasksUsed += (exec.tasksUsed || 0);

    // Track unique forms (use getFormId helper for workflow.triggers fallback)
    const formId = getFormId(exec);
    if (formId) {
      orgStats[orgName].uniqueForms.add(formId);
    }

    // Track daily activity
    const date = new Date(parseInt(exec.createdAt)).toISOString().split('T')[0];
    orgStats[orgName].dailyActivity[date] = (orgStats[orgName].dailyActivity[date] || 0) + 1;
  });

  // Convert to array and calculate additional metrics
  const orgArray = Object.values(orgStats).map(org => ({
    ...org,
    uniqueFormsCount: org.uniqueForms.size,
    activeDays: Object.keys(org.dailyActivity).length
  }));

  const totalOrgs = orgArray.length;
  const activeOrgs = orgArray.filter(org => org.formSubmissions > 0).length;
  const adoptionRate = totalOrgs > 0 ? ((activeOrgs / totalOrgs) * 100).toFixed(1) : 0;

  // Calculate additional metrics
  const avgFormsPerOrg = activeOrgs > 0 
    ? (orgArray.reduce((sum, org) => sum + org.uniqueFormsCount, 0) / activeOrgs).toFixed(1)
    : 0;
  
  const totalUniqueForms = new Set(
    formExecutions.map(e => e.triggerInfo?.formId).filter(Boolean)
  ).size;
  
  // Calculate power users (top 20% by submission count)
  const sortedBySubmissions = [...orgArray].sort((a, b) => b.formSubmissions - a.formSubmissions);
  const powerUserThreshold = Math.ceil(activeOrgs * 0.2);
  const powerUsers = sortedBySubmissions.slice(0, powerUserThreshold).length;

  // ============================================================
  // METRIC CARDS (6 cards)
  // ============================================================
  
  // Top Row - solid backgrounds
  RewstDOM.loadMetricCard("#adoption-metric-total-orgs", {
    title: "Total Organizations",
    subtitle: `In selected scope`,
    value: totalOrgs.toLocaleString(),
    icon: "business",
    color: "teal",
    solidBackground: true
  });

  RewstDOM.loadMetricCard("#adoption-metric-active-orgs", {
    title: "Active Organizations",
    subtitle: `With form submissions`,
    value: activeOrgs.toLocaleString(),
    icon: "verified",
    color: "fandango",
    solidBackground: true
  });

  RewstDOM.loadMetricCard("#adoption-metric-adoption-rate", {
    title: "Adoption Rate",
    subtitle: "Actively using forms",
    value: adoptionRate + "%",
    icon: "trending_up",
    color: "snooze",
    cardClass: "card card-accent-snooze",
    solidBackground: false
  });

  // Bottom Row - accent backgrounds
  RewstDOM.loadMetricCard("#adoption-metric-avg-forms", {
    title: "Avg Forms per Org",
    subtitle: "Unique forms submitted",
    value: avgFormsPerOrg,
    icon: "dynamic_form",
    color: "teal",
    cardClass: "card card-accent-teal",
    solidBackground: false
  });

  RewstDOM.loadMetricCard("#adoption-metric-unique-forms", {
    title: "Forms in Use",
    subtitle: "Distinct forms submitted",
    value: totalUniqueForms.toLocaleString(),
    icon: "description",
    color: "fandango",
    cardClass: "card card-accent-fandango",
    solidBackground: false
  });

  RewstDOM.loadMetricCard("#adoption-metric-power-users", {
    title: "Power Users",
    subtitle: "Top 20% by submissions",
    value: powerUsers.toLocaleString(),
    icon: "emoji_events",
    color: "bask",
    cardClass: "card card-accent-bask",
    solidBackground: false
  });

  // ============================================================
  // LEFT CHART: Line Chart or Bar Chart with Dropdown
  // ============================================================
  
  const renderLineChart = () => {
    // Get top 10 orgs by form submission count
    const top10Orgs = [...orgArray]
      .sort((a, b) => b.formSubmissions - a.formSubmissions)
      .slice(0, 10);

    // Build timeline data with proper date formatting (M/D format like Overall dashboard)
    const dateData = {};
    formExecutions.forEach(exec => {
      const timestamp = parseInt(exec.createdAt);
      const date = new Date(timestamp);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
      
      if (!dateData[dateStr]) {
        dateData[dateStr] = { sortKey: date.getTime() };
      }
    });
    
    // Sort dates by timestamp
    const dates = Object.keys(dateData).sort((a, b) => 
      dateData[a].sortKey - dateData[b].sortKey
    );

    // Create canvas
    const canvasWrapper = document.createElement('div');
    canvasWrapper.style.position = 'relative';
    canvasWrapper.style.height = '300px';
    
    const canvas = document.createElement('canvas');
    canvasWrapper.appendChild(canvas);

    // Crosshair plugin (same as overall dashboard)
    const crosshairPlugin = {
      id: 'crosshair',
      afterDraw: (chart) => {
        if (chart.tooltip?._active?.length) {
          const ctx = chart.ctx;
          const activePoint = chart.tooltip._active[0];
          const x = activePoint.element.x;
          
          const yScale = chart.scales.y || Object.values(chart.scales).find(scale => scale.axis === 'y');
          if (!yScale) return;
          
          const topY = yScale.top;
          const bottomY = yScale.bottom;

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(x, topY);
          ctx.lineTo(x, bottomY);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = 'rgba(156, 163, 175, 0.6)';
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.restore();
        }
      }
    };

    // Build datasets for each org - need to recalculate dailyActivity with M/D format
    const datasets = top10Orgs.map((org, idx) => {
      // Rebuild daily activity for this org using M/D format
      const orgDailyData = {};
      formExecutions
        .filter(e => {
          const orgName = e.organization?.name || e.triggerInfo?.organization?.name || 'Unknown';
          return orgName === org.name;
        })
        .forEach(exec => {
          const timestamp = parseInt(exec.createdAt);
          const date = new Date(timestamp);
          const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
          orgDailyData[dateStr] = (orgDailyData[dateStr] || 0) + 1;
        });
      
      const orgData = dates.map(date => orgDailyData[date] || 0);
      
      const colors = [
        'rgba(0, 188, 212, 0.7)',   // teal
        'rgba(233, 30, 99, 0.7)',   // fandango
        'rgba(255, 152, 0, 0.7)',   // orange
        'rgba(76, 175, 80, 0.7)',   // success
        'rgba(156, 39, 176, 0.7)',  // purple
        'rgba(255, 193, 7, 0.7)',   // bask
        'rgba(96, 125, 139, 0.7)',  // snooze
        'rgba(63, 81, 181, 0.7)',   // indigo
        'rgba(244, 67, 54, 0.7)',   // error
        'rgba(121, 85, 72, 0.7)'    // brown
      ];
      
      return {
        label: org.name,
        data: orgData,
        borderColor: colors[idx % colors.length].replace('0.7', '1'),
        backgroundColor: colors[idx % colors.length],
        borderWidth: 2,
        tension: 0.4,
        fill: false
      };
    });

    new Chart(canvas, {
      type: 'line',
      data: {
        labels: dates,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'bottom',
            align: 'center',
            labels: {
              padding: 12,
              boxWidth: 12,
              font: { size: 11 }
            }
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: (context) => {
                return `${context.dataset.label}: ${context.parsed.y} submissions`;
              }
            }
          },
          crosshair: true
        },
        scales: {
          x: {
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: {
              maxRotation: 45,
              minRotation: 45
            }
          },
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0
            },
            grid: { color: 'rgba(0,0,0,0.05)' }
          }
        }
      },
      plugins: [crosshairPlugin]
    });

    document.getElementById('adoption-chart-title-left').textContent = 'Form Submissions Over Time';
    RewstDOM.place(canvasWrapper, '#adoption-chart-left');
  };

  const renderBarChart = () => {
    // Get form submission counts by form
    const formCounts = {};
    const formOrgBreakdown = {};
    
    formExecutions.forEach(exec => {
      const formName = getFormName(exec);
      const orgName = exec.organization?.name || exec.triggerInfo?.organization?.name || 'Unknown';
      
      if (!formCounts[formName]) {
        formCounts[formName] = 0;
        formOrgBreakdown[formName] = {};
      }
      
      formCounts[formName]++;
      formOrgBreakdown[formName][orgName] = (formOrgBreakdown[formName][orgName] || 0) + 1;
    });

    // Get top 10 forms
    const top10Forms = Object.entries(formCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);

    // Get all unique orgs
    const allOrgs = [...new Set(formExecutions.map(e => 
      e.organization?.name || e.triggerInfo?.organization?.name || 'Unknown'
    ))];

    const colors = [
      'rgba(0, 188, 212, 0.7)',   // teal
      'rgba(233, 30, 99, 0.7)',   // fandango
      'rgba(255, 152, 0, 0.7)',   // orange
      'rgba(76, 175, 80, 0.7)',   // success
      'rgba(156, 39, 176, 0.7)',  // purple
      'rgba(255, 193, 7, 0.7)',   // bask
      'rgba(96, 125, 139, 0.7)',  // snooze
      'rgba(63, 81, 181, 0.7)',   // indigo
      'rgba(244, 67, 54, 0.7)',   // error
      'rgba(121, 85, 72, 0.7)'    // brown
    ];

    // Build datasets - one per org
    const datasets = allOrgs.slice(0, 10).map((org, idx) => {
      const data = top10Forms.map(formName => 
        formOrgBreakdown[formName]?.[org] || 0
      );
      
      return {
        label: org,
        data: data,
        backgroundColor: colors[idx % colors.length],
        borderColor: colors[idx % colors.length].replace('0.7', '1'),
        borderWidth: 1
      };
    });

    const canvasWrapper = document.createElement('div');
    canvasWrapper.style.position = 'relative';
    canvasWrapper.style.height = '300px';
    
    const canvas = document.createElement('canvas');
    canvasWrapper.appendChild(canvas);

    new Chart(canvas, {
      type: 'bar',
      data: {
        labels: top10Forms,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y', // Horizontal bars
        plugins: {
          legend: {
            position: 'bottom',
            align: 'center',
            labels: {
              padding: 12,
              boxWidth: 12,
              font: { size: 11 }
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                return `${context.dataset.label}: ${context.parsed.x} submissions`;
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            beginAtZero: true,
            ticks: { precision: 0 }
          },
          y: {
            stacked: true
          }
        }
      }
    });

    document.getElementById('adoption-chart-title-left').textContent = 'Most Popular Forms';
    RewstDOM.place(canvasWrapper, '#adoption-chart-left');
  };

  // Initial render - bar chart (most popular forms)
  renderBarChart();

  // Left chart dropdown handler
  document.getElementById('adoption-chart-left-selector').addEventListener('change', (e) => {
    if (e.target.value === 'forms') {
      renderBarChart();
    } else if (e.target.value === 'timeline') {
      renderLineChart();
    }
  });

  // ============================================================
  // RIGHT CHART: Doughnut with Dropdown
  // ============================================================
  
  const renderFormSubmissionsDoughnut = () => {
    // Get top 10 orgs by form submissions
    const top10 = [...orgArray]
      .sort((a, b) => b.formSubmissions - a.formSubmissions)
      .slice(0, 10);

    const otherCount = orgArray
      .slice(10)
      .reduce((sum, org) => sum + org.formSubmissions, 0);

    const labels = top10.map(org => org.name);
    const data = top10.map(org => org.formSubmissions);
    
    if (otherCount > 0) {
      labels.push('Others');
      data.push(otherCount);
    }

    const colors = [
      'rgba(0, 188, 212, 0.7)',
      'rgba(233, 30, 99, 0.7)',
      'rgba(255, 152, 0, 0.7)',
      'rgba(76, 175, 80, 0.7)',
      'rgba(156, 39, 176, 0.7)',
      'rgba(255, 193, 7, 0.7)',
      'rgba(96, 125, 139, 0.7)',
      'rgba(63, 81, 181, 0.7)',
      'rgba(244, 67, 54, 0.7)',
      'rgba(121, 85, 72, 0.7)',
      'rgba(158, 158, 158, 0.7)' // gray for "Others"
    ];

    const canvasWrapper = document.createElement('div');
    canvasWrapper.style.position = 'relative';
    canvasWrapper.style.height = '300px';
    
    const canvas = document.createElement('canvas');
    canvasWrapper.appendChild(canvas);

    const totalSubmissions = data.reduce((a, b) => a + b, 0);

    function formatCenterNumber(num) {
      if (num >= 10000000) return (num / 1000000).toFixed(1) + 'M';
      if (num >= 100000) return (num / 1000).toFixed(0) + 'K';
      return num.toLocaleString();
    }

    new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: colors.slice(0, labels.length),
          borderColor: '#ffffff',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: 'right',
            align: 'center',
            labels: {
              padding: 8,
              usePointStyle: true,
              boxWidth: 10,
              font: { size: 11 }
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed || 0;
                const percentage = ((value / totalSubmissions) * 100).toFixed(1);
                return `${context.label}: ${value.toLocaleString()} (${percentage}%)`;
              }
            }
          }
        }
      },
      plugins: [{
        id: 'centerText',
        afterDraw: (chart) => {
          const ctx = chart.ctx;
          const centerX = (chart.chartArea.left + chart.chartArea.right) / 2;
          const centerY = (chart.chartArea.top + chart.chartArea.bottom) / 2;

          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // Number
          const fontSize = chart.height < 250 ? 24 : (chart.height < 350 ? 32 : 40);
          ctx.font = `bold ${fontSize}px Poppins, sans-serif`;
          ctx.fillStyle = '#000000';
          ctx.fillText(formatCenterNumber(totalSubmissions), centerX, centerY - 10);

          // Label
          const labelFontSize = chart.height < 250 ? 10 : 12;
          ctx.font = `${labelFontSize}px Poppins, sans-serif`;
          ctx.fillStyle = '#90A4AE';
          ctx.fillText('Form Submissions', centerX, centerY + 20);

          ctx.restore();
        }
      }]
    });

    document.getElementById('adoption-doughnut-title').textContent = 'Form Submissions per Org';
    RewstDOM.place(canvasWrapper, '#adoption-chart-right');
  };

  const renderTimeSavedDoughnut = () => {
    // Get top 10 orgs by time saved
    const top10 = [...orgArray]
      .sort((a, b) => b.timeSaved - a.timeSaved)
      .slice(0, 10);

    const otherTime = orgArray
      .slice(10)
      .reduce((sum, org) => sum + org.timeSaved, 0);

    const labels = top10.map(org => org.name);
    const data = top10.map(org => org.timeSaved);
    
    if (otherTime > 0) {
      labels.push('Others');
      data.push(otherTime);
    }

    const colors = [
      'rgba(0, 188, 212, 0.7)',
      'rgba(233, 30, 99, 0.7)',
      'rgba(255, 152, 0, 0.7)',
      'rgba(76, 175, 80, 0.7)',
      'rgba(156, 39, 176, 0.7)',
      'rgba(255, 193, 7, 0.7)',
      'rgba(96, 125, 139, 0.7)',
      'rgba(63, 81, 181, 0.7)',
      'rgba(244, 67, 54, 0.7)',
      'rgba(121, 85, 72, 0.7)',
      'rgba(158, 158, 158, 0.7)'
    ];

    const canvasWrapper = document.createElement('div');
    canvasWrapper.style.position = 'relative';
    canvasWrapper.style.height = '300px';
    
    const canvas = document.createElement('canvas');
    canvasWrapper.appendChild(canvas);

    const totalTime = data.reduce((a, b) => a + b, 0);

    function formatCenterNumber(seconds) {
      const hours = seconds / 3600;
      if (hours >= 10000) return (hours / 1000).toFixed(1) + 'K';
      if (hours >= 1000) return hours.toFixed(0);
      return hours.toFixed(1);
    }

    new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: colors.slice(0, labels.length),
          borderColor: '#ffffff',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: 'right',
            align: 'center',
            labels: {
              padding: 8,
              usePointStyle: true,
              boxWidth: 10,
              font: { size: 11 }
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed || 0;
                const percentage = ((value / totalTime) * 100).toFixed(1);
                const formatted = formatTimeSaved(value);
                return `${context.label}: ${formatted} (${percentage}%)`;
              }
            }
          }
        }
      },
      plugins: [{
        id: 'centerText',
        afterDraw: (chart) => {
          const ctx = chart.ctx;
          const centerX = (chart.chartArea.left + chart.chartArea.right) / 2;
          const centerY = (chart.chartArea.top + chart.chartArea.bottom) / 2;

          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // Number
          const fontSize = chart.height < 250 ? 24 : (chart.height < 350 ? 32 : 40);
          ctx.font = `bold ${fontSize}px Poppins, sans-serif`;
          ctx.fillStyle = '#000000';
          ctx.fillText(formatCenterNumber(totalTime) + 'h', centerX, centerY - 10);

          // Label
          const labelFontSize = chart.height < 250 ? 10 : 12;
          ctx.font = `${labelFontSize}px Poppins, sans-serif`;
          ctx.fillStyle = '#90A4AE';
          ctx.fillText('Time Saved', centerX, centerY + 20);

          ctx.restore();
        }
      }]
    });

    document.getElementById('adoption-doughnut-title').textContent = 'Time Saved per Org';
    RewstDOM.place(canvasWrapper, '#adoption-chart-right');
  };

  // Initial render - form submissions doughnut
  renderFormSubmissionsDoughnut();

  // Right chart dropdown handler
  document.getElementById('adoption-doughnut-selector').addEventListener('change', (e) => {
    if (e.target.value === 'submissions') {
      renderFormSubmissionsDoughnut();
    } else if (e.target.value === 'time') {
      renderTimeSavedDoughnut();
    }
  });

  // ============================================================
  // TABLE: Organization Breakdown
  // ============================================================
  
  const tableData = orgArray.map(org => ({
    organization: org.name,
    form_submissions: org.formSubmissions,
    time_saved: formatTimeSaved(org.timeSaved),
    time_saved_raw: org.timeSaved, // For sorting
    executions: org.executions,
    tasks_used: org.tasksUsed
  }));

  const table = RewstDOM.createTable(tableData, {
    title: '<span class="material-icons text-rewst-teal">business</span> Organization Adoption',
    columns: ['organization', 'form_submissions', 'time_saved', 'executions', 'tasks_used'],
    headers: {
      organization: 'Organization',
      form_submissions: 'Form Submissions',
      time_saved: 'Time Saved',
      executions: 'Total Executions',
      tasks_used: 'Tasks Used'
    },
    searchable: true,
    defaultSort: {
      column: 'form_submissions',
      direction: 'desc'
    },
    transforms: {
      form_submissions: (value) => value.toLocaleString(),
      executions: (value) => value.toLocaleString(),
      tasks_used: (value) => value.toLocaleString()
    }
  });

  RewstDOM.place(table, '#adoption-table-orgs');

  console.log("✅ Adoption dashboard rendered successfully");
}