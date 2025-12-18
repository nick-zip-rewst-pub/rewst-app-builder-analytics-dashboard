/**
 * 
 * Form Details Dashboard Page
 * 
 * @fileoverview Sub page for dashboard for form specific detailed analytics
 * @author Nick Zipse <nick.zipse@rewst.com>
 * @version 1.3.3
 */

async function renderFormDetailsDashboard() {
  if (!window.dashboardData) return;

  // If already initialized and we have a selected form, just re-render it with new filters
  if (window.formSelectorInitialized) {
    if (window.selectedForm) {
      // Trigger fade animation on the display area
      const displayArea = document.getElementById("form-display-area");
      if (displayArea) {
        displayArea.style.animation = 'none';
        displayArea.offsetHeight; // Trigger reflow
        displayArea.style.animation = 'fadeInUp 0.4s ease-out';
      }
      
      renderSelectedForm(window.selectedForm);
    }
    return;
  }

  const allExecutions = getFilteredExecutions();
  const formExecutions = allExecutions.filter(e => {
    // Skip option generators
    if (e.workflow?.type === 'OPTION_GENERATOR') return false;

    // 1. Primary: check triggerInfo.type (most reliable)
    const t = e.triggerInfo?.type || e.triggerInfo?.Type || '';
    const tLower = String(t).toLowerCase();
    if (tLower === 'form submission') return true;

    // 2. Check for form-specific data (formId, submittedInputs, form object)
    if (e.triggerInfo?.formId || e.triggerInfo?.submittedInputs || e.form?.id) {
      return true;
    }

    // 3. Check conductor.input for Cron/Webhook signatures
    const conductorInput = e.conductor?.input || {};
    const hasCronSignature = conductorInput.cron && conductorInput.timezone;
    const hasWebhookSignature = conductorInput.method && conductorInput.headers;
    if (hasCronSignature || hasWebhookSignature) return false;

    // 4. If triggerInfo.type exists and is NOT "form submission", trust it
    // This filters out Manual/Test, Cron Job, Webhook, App Platform, etc.
    if (t && tLower !== '' && tLower !== 'form submission') return false;

    // 5. Fallback: check workflow.triggers ONLY when triggerInfo.type is missing
    if (e.workflow?.triggers) {
      const formTrigger = e.workflow.triggers.find(tr =>
        (tr.triggerType?.name === 'Form Submission' || tr.triggerType?.ref?.includes('form')) &&
        tr.formId
      );
      if (formTrigger) return true;
    }

    return false;
  });

  // Helper to get formId with workflow.triggers fallback
  function getFormIdFromExec(exec) {
    // 1. Try triggerInfo.formId (from context fetch)
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

  // Helper to get form name with forms cache fallback
  function getFormNameFromExec(exec, formId) {
    // 0. Check for async-resolved form name (from fetchMissingFormNames)
    if (exec._resolvedFormName) return exec._resolvedFormName;
    // 1. Try triggerInfo.formName
    if (exec.triggerInfo?.formName) return exec.triggerInfo.formName;
    // 2. Try form.name (legacy)
    if (exec.form?.name) return exec.form.name;
    // 3. Fallback: lookup from dashboardData.forms using formId
    if (formId && window.dashboardData?.forms) {
      const form = window.dashboardData.forms.find(f => f.id === formId);
      if (form?.name) return form.name;
    }
    // 4. Final fallback: use workflow name (forms from managed orgs aren't in parent's forms list)
    if (exec.workflow?.name) return exec.workflow.name;
    return '(Unnamed Form)';
  }

  // Build form list from executions (id + name) with fallbacks for large datasets
  // First, collect all unique form IDs with their org info
  const formIdMap = new Map(); // formId -> { id, name, orgName, orgId }
  formExecutions.forEach(f => {
    const id = getFormIdFromExec(f);
    if (!id) return;

    // Only add if we haven't seen this form ID yet
    if (!formIdMap.has(id)) {
      // Get org info for disambiguation
      const orgName = f.organization?.name || f.triggerInfo?.organization?.name || null;
      const orgId = f.organization?.id || f.triggerInfo?.organization?.id || null;
      formIdMap.set(id, { id, name: null, orgName, orgId });
    }
  });

  // Then build form list with best available name for each ID
  const forms = Array.from(formIdMap.values()).map(entry => {
    // Try to get name from dashboardData.forms first (most reliable)
    let name = null;
    if (window.dashboardData?.forms) {
      const cachedForm = window.dashboardData.forms.find(f => f.id === entry.id);
      if (cachedForm?.name) name = cachedForm.name;
    }
    // Fallback: find an execution with this form ID and get its name
    if (!name) {
      const exec = formExecutions.find(f => getFormIdFromExec(f) === entry.id);
      if (exec) name = getFormNameFromExec(exec, entry.id);
    }
    return { ...entry, name: name || '(Unnamed Form)' };
  });

  // Check for duplicate names and append org name to disambiguate
  const nameCounts = {};
  forms.forEach(f => {
    nameCounts[f.name] = (nameCounts[f.name] || 0) + 1;
  });

  // For forms with duplicate names, append the org name
  forms.forEach(f => {
    if (nameCounts[f.name] > 1 && f.orgName) {
      f.displayName = `${f.name} (${f.orgName})`;
    } else {
      f.displayName = f.name;
    }
  });

  forms.sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Selector container: prefer #form-selector-forms if present, else #form-selector
  const selectorId = document.getElementById('form-selector-forms') ? '#form-selector-forms' : '#form-selector';
  const selectorHost = document.querySelector(selectorId);
  if (!selectorHost) {
    console.warn('Form selector host not found.');
    return;
  }
  selectorHost.innerHTML = ''; // clear to avoid double-dropdowns

  // Create autocomplete like workflow page
  const autocomplete = RewstDOM.createAutocomplete(forms, {
    labelKey: 'displayName', // Use displayName which includes org for duplicates
    valueKey: 'id',
    placeholder: 'Select a form...',
    maxResults: Math.max(forms.length, 12),
    onSelect: (form) => renderSelectedForm(form)
  });

  RewstDOM.place(autocomplete, selectorId);
  window.formSelectorInitialized = true;

  // Hide detail area until selection
  const area = document.getElementById('form-display-area');
  if (area) area.style.display = 'none';
}

/* ============================================================
 * Handle selection
 * ============================================================ */
function renderSelectedForm(selected) {
  // Store for re-rendering on filter changes
  window.selectedForm = selected;

  const area = document.getElementById('form-display-area');
  if (!area) return;

  // Show display
  area.style.display = 'block';

  // Filter executions for this form id (with workflow.triggers fallback)
  const execs = (typeof getFilteredExecutions === 'function'
    ? getFilteredExecutions()
    : (window.dashboardData.executions || []));

  // Helper to get formId from execution with fallback
  function getExecFormId(exec) {
    if (exec.triggerInfo?.formId) return exec.triggerInfo.formId;
    if (exec.form?.id) return exec.form.id;
    if (exec.workflow?.triggers) {
      const formTrigger = exec.workflow.triggers.find(t =>
        t.triggerType?.name === 'Form Submission' ||
        t.triggerType?.ref?.includes('form')
      );
      if (formTrigger?.formId) return formTrigger.formId;
    }
    return null;
  }

  const executions = execs.filter(e => getExecFormId(e) === selected.id).map(e => ({
    ...e,
    // normalize organization/user presence
    organization: e.organization || e.triggerInfo?.organization || e.triggerInfo?.rawContext?.organization || null,
    user: e.user || e.triggerInfo?.user || e.triggerInfo?.rawContext?.user || null
  }));

  // Selected header
  const nameEl = document.getElementById('selected-form-name');
  const linkEl = document.getElementById('selected-form-link');
  if (nameEl) nameEl.textContent = selected.name || 'Form';
  if (linkEl) {
    // Build form link with fallback
    let formLink = executions[0]?.triggerInfo?.formLink || executions[0]?.form?.link;
    if (!formLink && selected.id) {
      const orgId = executions[0]?.organization?.id || window.selectedOrg?.id;
      if (orgId) {
        formLink = `https://app.rewst.io/organizations/${orgId}/forms/${selected.id}`;
      }
    }
    linkEl.href = formLink || '#';
  }

  renderFormMetrics(executions);
  renderFormInsights(executions);
  renderFormSubmissionsTable(executions);
  renderInputAnalytics(executions);
  enrichDynamicFormLabels(selected.id);
}

/* ============================================================
 * Metrics Cards (identical style to workflowdetail.js)
 * - 2 solid (teal, orange)
 * - 4 accent (fandango, purple, success, blue)
 * ============================================================ */
function renderFormMetrics(executions) {
  const total = executions.length || 0;
  const succeeded = executions.filter(e =>
    ['succeeded', 'completed', 'success'].includes(String(e.status || '').toLowerCase())
  ).length;

  const totalExecutions = executions.length;
  const totalTimeSaved = executions.reduce((sum, e) => sum + (e.humanSecondsSaved || 0), 0);
  const totalTasksUsed = executions.reduce((sum, e) => sum + (e.tasksUsed || 0), 0);
  const avgTasksUsed = totalExecutions ? (totalTasksUsed / totalExecutions).toFixed(1) : 0;
  const monetaryValue = (totalTimeSaved / 3600) * 50; // assuming $50/hr


  const orgCounts = executions.reduce((acc, e) => {
    const n = e.organization?.name || e.triggerInfo?.organization?.name || 'Unknown';
    acc[n] = (acc[n] || 0) + 1;
    return acc;
  }, {});
  const topOrg = Object.entries(orgCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  // Clear targets
  ['#form-metric-total', '#form-metric-time', '#form-metric-value', '#form-metric-org', '#form-metric-tasks', '#form-metric-tasks']
    .forEach(sel => { const el = document.querySelector(sel); if (el) el.innerHTML = ''; });

  // SOLID (match workflow)
  // --- Metric Cards ---

  // Total Time Saved (solid teal)
  RewstDOM.loadMetricCard("#form-metric-time", {
    title: "Total Time Saved",
    subtitle: "Across all submissions",
    value: formatTimeSaved(totalTimeSaved),
    icon: "schedule",
    color: "teal",
    solidBackground: true,
  });

  // Monetary Value (solid fandango)
  RewstDOM.loadMetricCard("#form-metric-value", {
    title: "Monetary Value",
    subtitle: "At $50/hour",
    value: "$" + parseInt(monetaryValue).toLocaleString(),
    icon: "attach_money",
    color: "fandango",
    solidBackground: true,
  });

  // Total Submissions (accent snooze)
  RewstDOM.loadMetricCard("#form-metric-total", {
    title: "Total Submissions",
    subtitle: "Form submissions completed",
    value: totalExecutions.toLocaleString(),
    icon: "list_alt",
    color: "snooze",
    cardClass: "card card-accent-snooze",
    solidBackground: false,
  });

  // Top Organization (accent teal)
  RewstDOM.loadMetricCard("#form-metric-org", {
    title: "Top Organization",
    subtitle: "Most submissions",
    value: topOrg,
    icon: "business",
    color: "snooze",
    cardClass: "card card-accent-snooze",
    solidBackground: false,
  });

  // Total Tasks Used (accent fandango)
  RewstDOM.loadMetricCard("#form-metric-tasks", {
    title: "Total Tasks Used",
    subtitle: "Across all submissions",
    value: totalTasksUsed.toLocaleString(),
    icon: "fact_check",
    color: "fandango",
    cardClass: "card card-accent-fandango",
    solidBackground: false,
  });

  // Avg Tasks Used (accent bask)
  RewstDOM.loadMetricCard("#form-metric-avg-tasks", {
    title: "Avg Tasks Used",
    subtitle: "Per form submission",
    value: avgTasksUsed,
    icon: "trending_up",
    color: "bask",
    cardClass: "card card-accent-bask",
    solidBackground: false,
  });
}


/* ============================================================
 * Insights Row (Stacked Bar + Doughnut)
 * - Bar: X = input fields, stacked by value choices
 * - Doughnut: toggle (org/user), toggle aligned right
 * ============================================================ */
function renderFormInsights(executions) {
  const barHost = document.getElementById('form-insight-bar');
  const pieHost = document.getElementById('form-insight-doughnut');
  if (!barHost || !pieHost) return;

  // Helper to get formId from execution with workflow.triggers fallback
  function getFormIdFromExec(exec) {
    if (exec.form?.id) return exec.form.id;
    if (exec.triggerInfo?.formId) return exec.triggerInfo.formId;
    if (exec.workflow?.triggers) {
      const formTrigger = exec.workflow.triggers.find(t =>
        (t.triggerType?.name === 'Form Submission' || t.triggerType?.ref?.includes('form')) &&
        t.formId
      );
      if (formTrigger?.formId) return formTrigger.formId;
    }
    return null;
  }

  // ---- Build field -> value -> count
  const fieldValueCounts = {};
  executions.forEach((s) => {
    const inputs = s.form?.input || s.triggerInfo?.submittedInputs || {};
    Object.entries(inputs).forEach(([k, v]) => {
      // Ignore null / undefined / empty values
      if (v === null || v === undefined || v === "") return;

      // Normalize to a valid schema.name (use fallback for formId)
      const key = normalizeFieldKey(getFormIdFromExec(s), k);
      if (!key) return; // skip anything not in schema

      fieldValueCounts[key] ??= {};

      // FIX: Handle arrays (multiselect) by counting each value separately
      const values = Array.isArray(v) ? v : [v];
      values.forEach(val => {
        const valStr = String(val ?? "—");
        fieldValueCounts[key][valStr] = (fieldValueCounts[key][valStr] || 0) + 1;
      });
    });
  });


  const fieldNames = Object.keys(fieldValueCounts);
  // Canonical field keys for data order
  const fieldKeys = Object.keys(fieldValueCounts);

  // Use the form's schema to render pretty labels for the x-axis (with fallback)
  const formId = getFormIdFromExec(executions[0]);
  const xLabels = fieldKeys.map(k => {
    const meta = resolveFormFieldMeta(formId, k, null);
    return meta.label || k;  // fallback to key if no label
  });


  // ---------- LEFT: BAR (stacked / grouped toggle)
  barHost.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <span class="material-icons text-rewst-teal">bar_chart</span>
        <h3 class="text-lg font-semibold text-rewst-black">Top Inputs Overview</h3>
      </div>
      <select id="form-bar-mode" class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-rewst-teal focus:outline-none">
        <option value="stacked">Stacked</option>
        <option value="grouped">Grouped</option>
      </select>
    </div>
    <div class="overflow-x-auto relative" style="height:400px;">
      <canvas id="form-bar-canvas"></canvas>
    </div>
  `;


  let barChart;
  const barCanvas = document.getElementById('form-bar-canvas');
  const barModeEl = document.getElementById('form-bar-mode');

  const rebuildBar = (mode) => {
    if (!fieldNames.length) {
      barCanvas.replaceWith(Object.assign(document.createElement('p'), {
        className: 'text-rewst-gray italic',
        textContent: 'No input data found for this form.'
      }));
      return;
    }

    const allValues = Array.from(
      new Set(fieldKeys.flatMap(k => Object.keys(fieldValueCounts[k])))
    );

    const colors = RewstDOM.getChartColors('multi');
    const datasets = allValues.map((val, i) => ({
      label: val,
      data: fieldKeys.map(k => fieldValueCounts[k][val] || 0),
      backgroundColor: colors[i % colors.length]
    }));


    if (barChart) barChart.destroy();

    const isStacked = mode === "stacked";

    barChart = new Chart(barCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: xLabels,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            mode: 'index',
            intersect: false,
            filter: function (tooltipItem) {
              return tooltipItem.parsed.y !== 0;
            }
          }
        },
        layout: { padding: { top: 10, right: 10, bottom: 10, left: 10 } },
        scales: {
          x: {
            stacked: (mode === 'stacked'),
            categoryPercentage: (mode === 'stacked') ? 0.5 : 0.99,
            barPercentage: (mode === 'stacked') ? 0.6 : 0.99,
            ticks: {
              autoSkip: false,
              maxRotation: 55,
              minRotation: 20,
              align: 'start',
              crossAlign: 'near',
              padding: 4,
              font: { size: 11 },
              callback: (v, i) => {
                const t = xLabels[i] || '';
                return t.length > 28 ? t.slice(0, 27) + '…' : t;
              }
            },
            grid: { drawTicks: false, color: 'rgba(0,0,0,0.05)' }
          },
          y: {
            stacked: (mode === 'stacked'),
            beginAtZero: true,
            ticks: { precision: 0 },
            grid: { color: 'rgba(0,0,0,0.05)' }
          }
        },
        animation: false
      }
    });

    barCanvas.style.width = (mode === 'stacked')
      ? `${Math.max(700, fieldKeys.length * 60)}px`
      : `${fieldKeys.length * 150}px`;
    barCanvas.style.maxWidth = '100%';
    barCanvas.style.display = 'block';
    barCanvas.parentElement.style.overflowX = 'auto';
  };

  rebuildBar('stacked');
  barModeEl.addEventListener('change', (e) => rebuildBar(e.target.value));

  // ---------- RIGHT: DOUGHNUT
  pieHost.innerHTML = `
  <div class="flex items-center justify-between mb-4">
    <div class="flex items-center gap-2">
      <span class="material-icons text-rewst-fandango">pie_chart</span>
      <h3 class="text-lg font-semibold text-rewst-black">Submission Breakdown</h3>
    </div>
    <select id="form-doughnut-mode" class="px-3 py-2 border border-gray-300 rounded-md text-sm">
      <option value="organization">By Organization</option>
      <option value="user">By User</option>
    </select>
  </div>
  <div class="flex justify-center w-full">
    <div style="height:350px; max-width:400px; width:100%;">
      <canvas id="form-doughnut-canvas"></canvas>
    </div>
  </div>
  `;

  const doughnutCanvas = document.getElementById('form-doughnut-canvas');
  const doughnutModeEl = document.getElementById('form-doughnut-mode');
  let doughnutChart;

  const rebuildDoughnut = (mode) => {
    const labelGetter = (s) =>
      mode === 'organization'
        ? s.triggerInfo?.organization?.name ||
        s.organization?.name ||
        'Unknown Org'
        : s.triggerInfo?.user?.username ||
        s.user?.username ||
        'Unknown User';

    const labels = {};
    executions.forEach(s => {
      const l = labelGetter(s);
      labels[l] = (labels[l] || 0) + 1;
    });

    const keys = Object.keys(labels);
    const vals = Object.values(labels);
    const colors = RewstDOM.getChartColors('multi').slice(0, keys.length);

    if (doughnutChart) doughnutChart.destroy();
    doughnutChart = new Chart(doughnutCanvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: keys,
        datasets: [{
          data: vals,
          backgroundColor: colors
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '55%',
        plugins: {
          legend: {
            position: 'bottom',
            align: 'center',
            labels: {
              boxWidth: 10,
              padding: 12,
              usePointStyle: true
            }
          },
          tooltip: { mode: 'nearest', intersect: false }
        },
        layout: { padding: 10 }
      }
    });
  };

  rebuildDoughnut('organization');
  doughnutModeEl.addEventListener('change', (e) => rebuildDoughnut(e.target.value));

}


/* ============================================================
 * Submissions Table (with header, icon link, and status badges)
 * ============================================================ */
function renderFormSubmissionsTable(executions) {

  // Helper to build execution link with fallback
  function getExecutionLink(e) {
    // 1. Try existing link
    if (e.link) return e.link;
    // 2. Build from execution ID and org ID
    const orgId = e.organization?.id || e.triggerInfo?.organization?.id;
    if (e.id && orgId) {
      return `https://app.rewst.io/organizations/${orgId}/results/${e.id}`;
    }
    // 3. Try using selected org as fallback (execution might be from parent org)
    if (e.id && window.selectedOrg?.id) {
      return `https://app.rewst.io/organizations/${window.selectedOrg.id}/results/${e.id}`;
    }
    return null;
  }

  const rows = executions.map(e => {
    return {
      view: getExecutionLink(e), // Build link with fallback
      timestamp: parseInt(e.createdAt), // Raw timestamp for sorting/filtering
      status: e.status || '—',
      organization: e.organization?.name || e.triggerInfo?.organization?.name || '—',
      user: e.user?.username || e.triggerInfo?.user?.username || '—',
      tasks_used: e.tasksUsed ?? 0 // Raw number for sorting
    };
  });

  const table = RewstDOM.createTable(rows, {
    title: '<span class="material-icons text-rewst-fandango">table_view</span> Form Submissions',
    columns: ['view', 'timestamp', 'status', 'organization', 'user', 'tasks_used'],
    headers: {
      view: 'View',
      timestamp: 'Timestamp',
      status: 'Status',
      organization: 'Organization',
      user: 'Submitted By',
      tasks_used: 'Tasks Used'
    },
    filters: {
      timestamp: {
        type: 'dateRange'
        // No label - just date inputs
      },
      status: { label: 'Status' },
      organization: { label: 'Organization' },
      user: { label: 'Submitted By' }
    },
    transforms: {
      view: (value) => {
        if (!value) {
          return `<span class="text-gray-400 flex items-center gap-1">
             <span class="material-icons" style="font-size:16px;line-height:1;">link_off</span>
             <span>Link unavailable</span>
           </span>`;
        }
        return `<a href="${value}" target="_blank" class="text-rewst-teal font-semibold flex items-center gap-1">
           <span class="material-icons" style="font-size:16px;line-height:1;">open_in_new</span>
           <span>View submission</span>
         </a>`;
      },
      timestamp: (value) => {
        const date = new Date(value);
        const dateStr = date.toLocaleDateString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: '2-digit'
        });
        const timeStr = date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
        return `${dateStr} ${timeStr}`;
      },
      tasks_used: (value) => {
        // Display formatted, but sorts on raw number
        return value === 0 ? '—' : value.toString();
      },
      status: (value) => {
        const v = String(value || '').toUpperCase();
        if (v === 'SUCCEEDED' || v === 'SUCCESS' || v === 'COMPLETED') {
          return '<span class="badge badge-success">SUCCEEDED</span>';
        }
        if (v === 'FAILED' || v === 'FAIL') {
          return '<span class="badge badge-error">FAILED</span>';
        }
        if (v === 'RUNNING') {
          return '<span class="badge badge-warning">RUNNING</span>';
        }
        if (v === 'CANCELED' || v === 'CANCELLED') {
          return '<span class="badge badge-warning">CANCELED</span>';
        }
        return `<span class="badge">${value || '—'}</span>`;
      }
    },
    defaultSort: {
      column: 'timestamp',
      direction: 'desc'
    },
    pagination: 10,
    searchable: true
  });

  RewstDOM.place(table, '#form-submissions-table');
}

/* ============================================================
 * Input Analytics (selector + horizontal bar + table)
 * ============================================================ */
function renderInputAnalytics(executions) {
  const selHost = document.getElementById("input-selector");
  const chartHost = document.getElementById("input-chart");
  const tableHost = document.getElementById("input-table");
  if (!selHost || !chartHost || !tableHost) return;

  selHost.innerHTML = "";
  chartHost.innerHTML = "";
  tableHost.innerHTML = "";

  // Helper to get formId from execution with workflow.triggers fallback
  function getFormIdFromExec(exec) {
    if (exec?.form?.id) return exec.form.id;
    if (exec?.triggerInfo?.formId) return exec.triggerInfo.formId;
    if (exec?.workflow?.triggers) {
      const formTrigger = exec.workflow.triggers.find(t =>
        (t.triggerType?.name === 'Form Submission' || t.triggerType?.ref?.includes('form')) &&
        t.formId
      );
      if (formTrigger?.formId) return formTrigger.formId;
    }
    return null;
  }

  // Aggregate field -> value -> count
  const fieldValueCounts = {};
  executions.forEach((s) => {
    const inputs = s.form?.input || s.triggerInfo?.submittedInputs || {};
    Object.entries(inputs).forEach(([k, v]) => {
      // Ignore null / undefined / empty values
      if (v === null || v === undefined || v === "") return;

      const key = normalizeFieldKey(getFormIdFromExec(s), k);
      if (!key) return; // skip anything not in schema

      fieldValueCounts[key] ??= {};

      // FIX: Handle arrays (multiselect) by counting each value separately
      const values = Array.isArray(v) ? v : [v];
      values.forEach(val => {
        const valStr = String(val ?? "—");
        fieldValueCounts[key][valStr] = (fieldValueCounts[key][valStr] || 0) + 1;
      });
    });
  });

  const fieldNames = Object.keys(fieldValueCounts);
  if (!fieldNames.length) {
    selHost.innerHTML = `<p class="text-rewst-gray italic">No input data found.</p>`;
    return;
  }

  // Create plain dropdown (no autocomplete)
  const select = document.createElement("select");
  select.className =
    "w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-rewst-teal focus:outline-none";
  fieldNames.forEach((n) => {
    const { label } = resolveFormFieldMeta(getFormIdFromExec(executions[0]), n, null);
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = label || n;
    select.appendChild(opt);
  });
  selHost.appendChild(select);

  // Auto select first field + render
  const defaultField = fieldNames[0];
  select.value = defaultField;
  drawInputAnalytics(defaultField, fieldValueCounts, chartHost, tableHost, executions);

  // Change listener
  select.addEventListener("change", (e) => {
    drawInputAnalytics(e.target.value, fieldValueCounts, chartHost, tableHost, executions);
  });
}

function drawInputAnalytics(field, fieldValueCounts, chartHost, tableHost, executions) {
  chartHost.innerHTML = "";
  tableHost.innerHTML = "";

  // Helper to get formId from execution with workflow.triggers fallback
  function getFormIdFromExec(exec) {
    if (exec?.form?.id) return exec.form.id;
    if (exec?.triggerInfo?.formId) return exec.triggerInfo.formId;
    if (exec?.workflow?.triggers) {
      const formTrigger = exec.workflow.triggers.find(t =>
        (t.triggerType?.name === 'Form Submission' || t.triggerType?.ref?.includes('form')) &&
        t.formId
      );
      if (formTrigger?.formId) return formTrigger.formId;
    }
    return null;
  }

  const dataMap = fieldValueCounts[field] || {};
  const formId = getFormIdFromExec(executions[0]);
  const labels = Object.keys(dataMap);
  const counts = Object.values(dataMap);
  const total = counts.reduce((a, b) => a + b, 0);

  // Sort descending by submissions
  const sorted = labels
    .map((val, i) => ({
      label: resolveFormFieldMeta(formId, field, val).displayValue,
      count: counts[i],
    }))
    .sort((a, b) => b.count - a.count);

  const sortedLabels = sorted.map((x) => x.label);
  const sortedCounts = sorted.map((x) => x.count);

  // Horizontal bar chart
  const wrap = document.createElement("div");
  wrap.className = "relative w-full overflow-x-auto";
  wrap.style.height = Math.max(220, sortedLabels.length * 26) + "px";
  const canvas = document.createElement("canvas");
  wrap.appendChild(canvas);
  chartHost.appendChild(wrap);

  new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: sortedLabels,
      datasets: [
        {
          label: `Responses for ${resolveFormFieldMeta(formId, field).label}`,
          data: sortedCounts,
          backgroundColor: RewstDOM.getChartColors("multi"),
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true } },
    },
  });

  // Table: value, submissions, %
  const rows = sorted.map(({ label, count }) => ({
    input_value: label,
    submissions: count,
    percentage: total ? `${((count / total) * 100).toFixed(1)}%` : "0.0%",
  }));

  const table = RewstDOM.createTable(rows, {
    columns: ["input_value", "submissions", "percentage"],
    headers: {
      input_value: "Input Value",
      submissions: "Submissions",
      percentage: "Percentage",
    },
    pagination: 10,
    sortable: true,
    compact: true,
  });

  RewstDOM.place(table, tableHost);
}


/* ============================================================
 * Helpers
 * ============================================================ */
function countBy(arr) {
  return arr.reduce((acc, v) => (acc[v] = (acc[v] || 0) + 1, acc), {});
}

/**
 * Normalize a raw input key to a valid schema.name for the given form.
 * - If form is in cache: returns key only if it matches schema (filters internal keys)
 * - If form NOT in cache (managed org): returns raw key as fallback (allows data through)
 */
function normalizeFieldKey(formId, rawKey) {
  const allForms = window.dashboardData?.forms || [];
  const form = allForms.find(f => f.id === formId);

  // Form not in cache (managed org form) - allow raw key through as fallback
  if (!form) return rawKey;

  // Form in cache - validate against schema to filter internal/system keys
  const match = form.fields?.find(fl => fl.schema?.name === rawKey);
  return match ? rawKey : null;
}


/**
 * Resolve form input metadata (label + human-readable value)
 * using data already loaded into window.dashboardData.forms
 */
function resolveFormFieldMeta(formId, fieldKey, rawValue) {
  try {
    const allForms = window.dashboardData?.forms || [];
    if (!Array.isArray(allForms) || !allForms.length)
      return { label: fieldKey, displayValue: String(rawValue ?? "—") };

    const form = allForms.find(f => f.id === formId);
    if (!form) return { label: fieldKey, displayValue: String(rawValue ?? "—") };

    const field = form.fields?.find(fl => fl?.schema?.name === fieldKey);
    if (!field) return { label: fieldKey, displayValue: String(rawValue ?? "—") };

    const schema = field.schema || {};
    const label = schema.label || fieldKey;
    let displayValue = String(rawValue ?? "—");

    // Handle enum fields
    if (Array.isArray(schema.enum)) {
      const match = schema.enum.find(e => String(e.value) === String(rawValue));
      if (match?.label) displayValue = match.label;
    }

    // Handle multi-select / array enums
    if (schema.type === "array" && schema.items?.enum) {
      const vals = Array.isArray(rawValue) ? rawValue : [rawValue];
      displayValue = vals
        .map(v => {
          const m = schema.items.enum.find(e => String(e.value) === String(v));
          return m?.label || String(v);
        })
        .join(", ");
    }

    // Fallback for dynamic sources - NO "(dynamic)" suffix
    if (schema.enumSourceWorkflow) {
      displayValue = String(rawValue ?? "—");
    }

    return { label, displayValue };
  } catch (err) {
    console.warn("resolveFormFieldMeta failed:", err);
    return { label: fieldKey, displayValue: String(rawValue ?? "—") };
  }
}

/**
 * Enrich dynamic form labels using rewst.getLastWorkflowExecution(wfId)
 */
async function enrichDynamicFormLabels(formId) {
  let loadingToast;

  try {
    const forms = window.dashboardData?.forms || [];
    const executions = window.dashboardData?.executions || [];
    if (!forms.length || !executions.length) return;

    const form = forms.find(f => f.id === formId);
    if (!form) {
      console.log("[Dynamic Label Enrichment] No form found for ID:", formId);
      return;
    }

    console.log("[Dynamic Label Enrichment] Running for form:", form.name);

    // Fields that have dynamic enum workflows
    const dynamicFields = (form.fields || []).filter(
      f => f.schema?.enumSourceWorkflow?.id
    );
    if (!dynamicFields.length) {
      console.log("[Dynamic Label Enrichment] No dynamic fields found.");
      return;
    }

    // Show loading toast
    loadingToast = RewstDOM.showInfo("Prettifying input names...", 0);

    const rewstEnums = {};

    console.log(`[Dynamic Label Enrichment] Found ${dynamicFields.length} dynamic field(s)`);

    // Fetch latest workflow execution results for each enum source
    for (const field of dynamicFields) {
      const wfId = field.schema.enumSourceWorkflow.id;
      const fieldName = field.schema.name;

      // Get the label and value keys from schema
      const labelKey = field.schema.enumSourceWorkflow.labelKey || 'name';
      const valueKey = field.schema.enumSourceWorkflow.valueKey || 'id';

      if (!wfId) continue;

      console.log(`[Dynamic Enum] Fetching options for field "${fieldName}" from workflow ${wfId}`);
      console.log(`[Dynamic Enum] Using labelKey="${labelKey}", valueKey="${valueKey}"`);

      try {
        const result = await window.rewst.getLastWorkflowExecution(wfId);
        const options =
          result?.output?.options ||
          result?.execution?.output?.options ||
          result?.conductor?.output?.options ||
          [];

        console.log(`[Dynamic Enum] Raw options for workflow ${wfId}:`, options);

        if (Array.isArray(options) && options.length) {
          rewstEnums[wfId] = options.map(o => ({
            label: o[labelKey] ?? o.name ?? o.label ?? String(o.id ?? "—"),
            value: String(o[valueKey] ?? o.id ?? o.value ?? o.label ?? "—")
          }));
          console.log(`[Dynamic Enum] ✅ Loaded ${options.length} options for workflow ${wfId}:`, rewstEnums[wfId]);
        } else {
          console.log(`[Dynamic Enum] ⚠️ No options found for workflow ${wfId}`);
        }
      } catch (err) {
        console.warn(`[Dynamic Enum] ❌ Failed fetching for workflow ${wfId}:`, err);
      }
    }

    // If no new enums found, hide loading toast and exit
    if (!Object.keys(rewstEnums).length) {
      RewstDOM._removeToast(loadingToast);
      console.log("[Dynamic Label Enrichment] No enum options retrieved.");
      return;
    }

    // Filter executions just for this form (with workflow.triggers fallback)
    const formExecutions = executions.filter(e => {
      // 1. Check form.id
      if (e.form?.id === formId) return true;
      // 2. Check triggerInfo.formId
      if (e.triggerInfo?.formId === formId) return true;
      // 3. Fallback: check workflow.triggers for form ID
      if (e.workflow?.triggers) {
        const formTrigger = e.workflow.triggers.find(t =>
          (t.triggerType?.name === 'Form Submission' || t.triggerType?.ref?.includes('form')) &&
          t.formId === formId
        );
        if (formTrigger) return true;
      }
      return false;
    });

    console.log(`[Dynamic Label Enrichment] Processing ${formExecutions.length} executions`);

    // Replace raw IDs with pretty names
    let replacementCount = 0;
    let missingCount = 0;
    formExecutions.forEach((exec, execIndex) => {
      const inputs = exec.form?.input || exec.triggerInfo?.submittedInputs || {};
      Object.entries(inputs).forEach(([key, val]) => {
        const field = form.fields?.find(f => f.schema?.name === key);
        if (!field) {
          console.log(`[Label Swap] Field "${key}" not found in form schema`);
          return;
        }

        const wfId = field.schema?.enumSourceWorkflow?.id;
        if (!wfId) return; // Not a dynamic field

        const opts = rewstEnums[wfId];
        if (!opts) {
          console.log(`[Label Swap] No options loaded for workflow ${wfId} (field: ${key})`);
          return;
        }

        console.log(`[Label Swap] Attempting to match value for field "${key}"`);
        console.log(`[Label Swap] Value type: ${Array.isArray(val) ? 'array' : typeof val}`);
        if (Array.isArray(val)) {
          console.log(`[Label Swap] Array length: ${val.length}`);
        }
        console.log(`[Label Swap] Available options count: ${opts.length}`);

        // Check if value is empty
        if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) {
          console.log(`[Label Swap] ✅ Empty value → "(empty)"`);
          inputs[key] = "(empty)";
          return;
        }

        const match = opts.find(o => o.value === String(val));
        if (match) {
          console.log(`[Label Swap] ✅ Single value matched! → "${match.label}"`);
          inputs[key] = match.label;
          replacementCount++;
        } else if (Array.isArray(val)) {
          // It's an array - map each string directly
          const labels = val.map((v, idx) => {
            const valStr = String(v);
            console.log(`[Label Swap] Comparing array item ${idx}:`);
            console.log(`  Item length: ${valStr.length}`);
            console.log(`  First 200 chars: "${valStr.substring(0, 200)}..."`);

            // Try exact match
            const m = opts.find(o => o.value === valStr);

            if (m) {
              console.log(`[Label Swap] ✅ Array item matched! → "${m.label}"`);
              replacementCount++;
              return m.label;
            } else {
              console.log(`[Label Swap] ❌ No match for array item`);
              missingCount++;
              return "(deleted)";
            }
          });
          inputs[key] = labels; // Keep as array so chart can split them out
        } else {
          console.log(`[Label Swap] ⚠️ No match found for value in field "${key}"`);
          inputs[key] = "(deleted)";
          missingCount++;
        }
      });
    });

    console.log(`[Dynamic Label Enrichment] Applied ${replacementCount} label replacements, ${missingCount} marked as deleted`);
    console.log("[Dynamic Label Enrichment] Replacement summary:", rewstEnums);

    // ✅ Re-render ONLY bar chart and input analytics
    renderFormInsights(formExecutions);
    renderInputAnalytics(formExecutions);

    // Remove loading toast and show success (3 second auto-dismiss)
    RewstDOM._removeToast(loadingToast);
    RewstDOM.showSuccess("Prettified input labels from option generators", 3000);

  } catch (err) {
    console.warn("enrichDynamicFormLabels failed:", err);

    // Remove loading toast and show error (5 second auto-dismiss)
    if (loadingToast) {
      RewstDOM._removeToast(loadingToast);
    }
    RewstDOM.showError(`Failed to prettify input names: ${err.message}`, 5000);
  }
}


/**
 * Update rendered dynamic labels across analytics once cache is ready.
 */
function updateRenderedDynamicLabels(localCache, formId) {
  try {
    // Filter with workflow.triggers fallback for large datasets
    const executions = (window.dashboardData?.executions || []).filter(e => {
      if (e.form?.id === formId) return true;
      if (e.triggerInfo?.formId === formId) return true;
      if (e.workflow?.triggers) {
        const formTrigger = e.workflow.triggers.find(t =>
          (t.triggerType?.name === 'Form Submission' || t.triggerType?.ref?.includes('form')) &&
          t.formId === formId
        );
        if (formTrigger) return true;
      }
      return false;
    });
    if (!executions.length) return;

    executions.forEach(exec => {
      const inputs = exec.form?.input || exec.triggerInfo?.submittedInputs || {};
      const form = (window.dashboardData.forms || []).find(f => f.id === formId);
      if (!form) return;

      Object.entries(inputs).forEach(([k, v]) => {
        const field = form.fields?.find(fl => fl.schema?.name === k);
        if (!field) return;
        const schema = field.schema || {};
        if (!schema.enumSourceWorkflow) return;

        const wfId = schema.enumSourceWorkflow.id;
        const opts = localCache[wfId];
        if (!opts) return;

        const match = opts.find(o => String(o.value) === String(v));
        if (match?.label) inputs[k] = match.label;
      });
    });

    // ✅ Re-render only this form's visuals
    renderFormInsights(executions);
    renderInputAnalytics(executions);
  } catch (err) {
    console.warn("updateRenderedDynamicLabels failed:", err);
  }
}