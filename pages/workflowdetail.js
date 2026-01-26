/**
 * Workflow Details Dashboard Page
 * @fileoverview Sub page for dashboard for workflow specific detailed analytics
 * @author Nick Zipse <nick.zipse@rewst.com>
 * @version 1.3.3
 */

/* ============================================================
 * UNIVERSAL TIME FORMATTING HELPER
 * Formats seconds into human-readable time with proper units
 * ============================================================ */
function formatTimeSaved(seconds) {
  const s = parseFloat(seconds || 0);
  if (!s || s === 0) return '—';
  
  // Less than 1 minute: show seconds
  if (s < 60) {
    return s.toFixed(1) + 's';
  }
  
  // Less than 1 hour: show minutes
  const minutes = s / 60;
  if (minutes < 60) {
    return minutes.toFixed(1) + 'm';
  }
  
  // 1+ hours: show hours with comma formatting for thousands
  const hours = minutes / 60;
  if (hours < 1000) {
    return hours.toFixed(1) + 'h';
  }
  
  // Thousands of hours: add commas
  return hours.toLocaleString('en-US', { 
    minimumFractionDigits: 1, 
    maximumFractionDigits: 1 
  }) + 'h';
}

function renderWorkflowDetailsDashboard() {
  if (!window.dashboardData) {
    console.error("No dashboard data available");
    return;
  }

  // Build workflows list from executions ONLY - only show workflows that have been run
  // This prevents showing 50+ workflows with no data to display
  const workflowMap = new Map();
  const filteredExecs = getFilteredExecutions();

  // Only add workflows that have executions
  filteredExecs.forEach(exec => {
    if (exec.workflow?.id && exec.workflow?.name) {
      // Use workflow NAME as key since same-named workflows across orgs should be grouped
      const key = exec.workflow.name;
      if (!workflowMap.has(key)) {
        const execOrgId = exec.organization?.id;
        workflowMap.set(key, {
          id: exec.workflow.id,
          name: exec.workflow.name,
          type: exec.workflow.type,
          humanSecondsSaved: exec.workflow.humanSecondsSaved,
          triggers: exec.workflow.triggers || [],
          orgId: execOrgId,
          link: execOrgId ? `${rewst._getBaseUrl()}/organizations/${execOrgId}/workflows/${exec.workflow.id}` : null
        });
      }
    }
  });

  const workflows = Array.from(workflowMap.values()).sort((a, b) =>
    (a.name || '').localeCompare(b.name || '')
  );

  // Track count for logging
  const workflowsFromApi = window.dashboardData.workflows || [];

  // If already initialized and we have a selected workflow, just re-render it with new filters
  if (window.workflowSelectorInitialized) {
    if (window.selectedWorkflow) {
      const filteredExecutions = getFilteredExecutions();

      // Trigger fade animation on the display area
      const displayArea = document.getElementById("workflow-display-area");
      if (displayArea) {
        displayArea.style.animation = 'none';
        displayArea.offsetHeight; // Trigger reflow
        displayArea.style.animation = 'fadeInUp 0.4s ease-out';
      }

      renderSelectedWorkflow(window.selectedWorkflow, filteredExecutions);
    }
    return;
  }

  const selectorEl = document.getElementById("workflow-selector");
  if (!selectorEl) {
    console.error("workflow-selector element not found!");
    return;
  }

  const autocomplete = RewstDOM.createAutocomplete(workflows, {
    labelKey: "name",
    valueKey: "id",
    placeholder: "Search for a workflow...",
    maxResults: workflows.length,
    onSelect: (workflow) => {
      const filteredExecutions = getFilteredExecutions();
      renderSelectedWorkflow(workflow, filteredExecutions);
    },
  });

  RewstDOM.place(autocomplete, "#workflow-selector");
  window.workflowSelectorInitialized = true;
  console.log(`✅ Workflow selector initialized with ${workflows.length} workflows (${workflowsFromApi.length} from API, ${workflows.length - workflowsFromApi.length} from executions)`);
}

/**
 * Handle selected workflow
 */
function renderSelectedWorkflow(workflow, executions) {
  // Store for re-rendering on filter changes
  window.selectedWorkflow = workflow;

  console.log("Selected workflow:", workflow.name, "ID:", workflow.id);
  console.log("Total executions to filter:", executions.length);

  // Debug: log sample execution workflow IDs to check for mismatches
  const sampleExecs = executions.slice(0, 5);
  console.log("Sample execution workflow IDs:", sampleExecs.map(e => e.workflow?.id));

  const displayArea = document.getElementById("workflow-display-area");
  displayArea.style.display = "block";

  document.getElementById("selected-workflow-name").textContent = workflow.name;

  // Build workflow link with organization ID (per REWST_LINK_PATTERNS.md)
  // Priority: workflow.link > workflow.orgId > selectedOrg.id > rewst.orgId
  const baseUrl = rewst._getBaseUrl(); // Returns https://app.rewst.io or configured URL
  const orgId = workflow.orgId || window.selectedOrg?.id || rewst.orgId;
  const workflowLink = workflow.link || (orgId ? `${baseUrl}/organizations/${orgId}/workflows/${workflow.id}` : null);

  document.getElementById("selected-workflow-link").href = workflowLink;

  // Filter by workflow NAME (not ID) because same-named workflows across sub-orgs
  // have different IDs but should be shown together when clicked from the table
  const workflowExecutions = executions.filter(
    (e) => e.workflow?.name === workflow.name
  );

  console.log(`Found ${workflowExecutions.length} executions for workflow "${workflow.name}"`);

  renderWorkflowMetrics(workflowExecutions);
  renderWorkflowTimeline(workflowExecutions);
  renderWorkflowFailures(workflowExecutions);
  renderWorkflowExecutionsTable(workflowExecutions, executions); // Pass full executions for parent lookup
}

/**
 * Render metric cards
 */
function renderWorkflowMetrics(execs) {
  const totalExecutions = execs.length;
  const succeededExecutions = execs.filter((e) =>
    ["succeeded", "SUCCEEDED", "COMPLETED", "SUCCESS"].includes(e.status)
  ).length;
  const failedExecutions = execs.filter((e) =>
    ["FAILED", "failed"].includes(e.status)
  ).length;

  const successRate =
    totalExecutions > 0
      ? ((succeededExecutions / totalExecutions) * 100).toFixed(1)
      : 0;
  const failureRate =
    totalExecutions > 0
      ? ((failedExecutions / totalExecutions) * 100).toFixed(1)
      : 0;

  const totalSecondsSaved = execs.reduce(
    (sum, e) => sum + (e.humanSecondsSaved || 0),
    0
  );
  const hoursSaved = totalSecondsSaved / 3600;
  const monetaryValue = (hoursSaved * 50).toFixed(0);
  const totalTasksUsed = execs.reduce(
    (sum, e) => sum + (e.tasksUsed || 0),
    0
  );

  const avgTasksPerRun =
    totalExecutions > 0
      ? (totalTasksUsed / totalExecutions).toFixed(1)
      : 0;

  // Use formatTimeSaved for the time saved metric
  RewstDOM.loadMetricCard("#workflow-metric-time", {
    title: "Time Saved",
    subtitle: "Total hours for this workflow",
    value: formatTimeSaved(totalSecondsSaved),
    icon: "schedule",
    color: "teal",
    solidBackground: true,
  });

  RewstDOM.loadMetricCard("#workflow-metric-value", {
    title: "Monetary Value",
    subtitle: "At $50/hour",
    value: "$" + parseInt(monetaryValue).toLocaleString(),
    icon: "attach_money",
    color: "fandango",
    solidBackground: true,
  });

  RewstDOM.loadMetricCard("#workflow-metric-tasks", {
    title: "Total Task Usage",
    subtitle: totalExecutions + " executions",
    value: totalTasksUsed.toLocaleString(),
    icon: "task_alt",
    color: "snooze",
    cardClass: "card card-accent-snooze",
    solidBackground: false,
  });

  RewstDOM.loadMetricCard("#workflow-metric-success", {
    title: "Success Rate",
    subtitle: succeededExecutions + " succeeded",
    value: successRate + "%",
    icon: "check_circle",
    color: "teal",
    cardClass: "card card-accent-teal",
    solidBackground: false,
  });

  RewstDOM.loadMetricCard("#workflow-metric-failures", {
    title: "Failure Rate",
    subtitle: failedExecutions + " failed",
    value: failureRate + "%",
    icon: "error",
    color: "error",
    cardClass: "card card-accent-error",
    solidBackground: false,
  });

  RewstDOM.loadMetricCard("#workflow-metric-runtime", {
    title: "Avg Tasks Per Run",
    subtitle: "Average tasks used",
    value: avgTasksPerRun,
    icon: "functions",
    color: "fandango",
    cardClass: "card card-accent-fandango",
    solidBackground: false,
  });
}

/**
 * Render timeline chart (executions vs tasks)
 */
function renderWorkflowTimeline(execs) {
  const executionsByDay = {};
  const tasksByDay = {};

  execs.forEach((exec) => {
    const date = new Date(parseInt(exec.createdAt));
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
    if (!executionsByDay[dateStr]) {
      executionsByDay[dateStr] = { succeeded: 0, failed: 0, sortKey: date.getTime() };
      tasksByDay[dateStr] = { tasks: 0, sortKey: date.getTime() };
    }

    if (["succeeded", "SUCCEEDED", "COMPLETED", "SUCCESS"].includes(exec.status))
      executionsByDay[dateStr].succeeded++;
    if (["FAILED", "failed"].includes(exec.status))
      executionsByDay[dateStr].failed++;

    tasksByDay[dateStr].tasks += exec.tasksUsed || 0;
  });

  const sortedDates = Object.keys(executionsByDay).sort(
    (a, b) => executionsByDay[a].sortKey - executionsByDay[b].sortKey
  );
  const succeededData = sortedDates.map((d) => executionsByDay[d].succeeded);
  const failedData = sortedDates.map((d) => executionsByDay[d].failed);
  const taskChartData = sortedDates.map((d) => tasksByDay[d].tasks);

  document.getElementById("workflow-timeline").innerHTML = `
    <div class="card p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-semibold text-rewst-black">Timeline</h3>
        <select id="workflow-timeline-toggle" class="input-field py-1 px-3 border border-gray-200 rounded-md">
          <option value="executions">Executions</option>
          <option value="tasks">Task Usage</option>
        </select>
      </div>
      <div id="workflow-timeline-chart"></div>
    </div>
  `;

  const renderChart = (type) => {
    const canvas = document.createElement("canvas");
    const wrapper = document.createElement("div");
    wrapper.className = "relative w-full";
    wrapper.style.height = "300px";
    wrapper.appendChild(canvas);

    const datasets =
      type === "executions"
        ? [
            {
              label: "Succeeded",
              data: succeededData,
              borderColor: "rgba(16,185,129,1)",
              backgroundColor: "rgba(16,185,129,0.1)",
              borderWidth: 2,
              tension: 0.4,
              fill: true,
            },
            {
              label: "Failed",
              data: failedData,
              borderColor: "rgba(239,68,68,1)",
              backgroundColor: "rgba(239,68,68,0.1)",
              borderWidth: 2,
              tension: 0.4,
              fill: true,
            },
          ]
        : [
            {
              label: "Tasks",
              data: taskChartData,
              borderColor: "rgba(0,148,144,1)",
              backgroundColor: "rgba(0,148,144,0.1)",
              borderWidth: 2,
              tension: 0.4,
              fill: true,
            },
          ];

    new Chart(canvas, {
      type: "line",
      data: { labels: sortedDates, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: type === "executions" ? "Number of Executions" : "Number of Tasks",
            },
          },
        },
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: { usePointStyle: true, padding: 15 },
          },
        },
      },
    });

    RewstDOM.place(wrapper, "#workflow-timeline-chart");
  };

  renderChart("executions");
  document
    .getElementById("workflow-timeline-toggle")
    .addEventListener("change", (e) => renderChart(e.target.value));
}

/**
 * Render failures table
 */
function renderWorkflowFailures(execs) {
  const failed = execs.filter((e) => ["FAILED", "failed"].includes(e.status));
  const target = document.getElementById("workflow-failures");

  if (failed.length === 0) {
    target.innerHTML = "";
    return;
  }

  const failureData = failed
    .sort((a, b) => parseInt(b.createdAt) - parseInt(a.createdAt))
    .slice(0, 10)
    .map((e) => ({
      execution_id: e.id,
      execution_link: e.link,
      timestamp: new Date(parseInt(e.createdAt)).toLocaleString(),
      status: e.status,
      runtime:
        e.createdAt && e.updatedAt
          ? ((parseInt(e.updatedAt) - parseInt(e.createdAt)) / 1000)
          : null,
      trigger_type: e.triggerInfo?.type || "Unknown",
    }));

  const table = RewstDOM.createTable(failureData, {
    title: '<span class="material-icons text-red-600">priority_high</span> Recent Failures',
    columns: ["execution_id", "timestamp", "status", "runtime", "trigger_type"],
    transforms: {
      execution_id: (value, row) =>
        `<a href="${row.execution_link}" target="_blank" class="flex items-center gap-2 text-rewst-teal hover:text-rewst-light-teal"><span class="material-icons" style="font-size:16px;">open_in_new</span><span>View execution</span></a>`,
      status: () => '<span class="badge badge-error">FAILED</span>',
    },
  });

  RewstDOM.place(table, "#workflow-failures");
}

/**
 * Render recent executions table
 */
function renderWorkflowExecutionsTable(execs, allExecutions = []) {
  const recentExecs = execs
    .sort((a, b) => parseInt(b.createdAt) - parseInt(a.createdAt))
    .slice(0, 100);

  // Check if any executions have parents (sub-workflows)
  // Use originatingExecutionId (root) with fallback to parentExecutionId
  const hasAnySubWorkflows = recentExecs.some(e => e.originatingExecutionId || e.parentExecutionId);

  // Build a lookup map for originating executions (execution ID -> workflow name)
  const parentLookup = new Map();
  if (hasAnySubWorkflows && allExecutions.length > 0) {
    allExecutions.forEach(exec => {
      parentLookup.set(exec.id, exec.workflow?.name || 'Unknown Workflow');
    });
  }

  const data = recentExecs.map((e) => {
    const baseUrl = rewst._getBaseUrl();
    const orgId = e.organization?.id || rewst.orgId;

    // Look up originating (root) workflow name if this is a sub-workflow
    // Use originatingExecutionId to link to the root execution, fallback to parentExecutionId
    const originatingId = e.originatingExecutionId || e.parentExecutionId;
    const originatingWorkflowName = originatingId ? parentLookup.get(originatingId) : null;

    return {
      execution_id: e.id,
      execution_link: e.link,
      timestamp: parseInt(e.createdAt), // KEEP RAW TIMESTAMP HERE
      status: e.status,
      organization: e.organization?.name || "Unknown",
      parent_execution: originatingId ? {
        id: originatingId,
        link: `${baseUrl}/organizations/${orgId}/results/${originatingId}`,
        workflowName: originatingWorkflowName || 'Unknown Workflow'
      } : null,
      tasks_used: e.tasksUsed || 0,
      trigger_type: e.triggerInfo?.type || "Unknown",
    };
  });

  // Conditionally include parent_execution column if any sub-workflows exist
  const columns = ["execution_id", "timestamp", "status", "organization"];
  if (hasAnySubWorkflows) {
    columns.push("parent_execution");
  }
  columns.push("tasks_used", "trigger_type");

  const headers = {
    execution_id: "Execution",
    timestamp: "Date",
    status: "Status",
    organization: "Organization",
    tasks_used: "Tasks Used",
    trigger_type: "Trigger Type"
  };
  if (hasAnySubWorkflows) {
    headers.parent_execution = "Parent Execution";
  }

  const table = RewstDOM.createTable(data, {
    title: '<span class="material-icons text-rewst-teal">history</span> Recent Executions',
    columns: columns,
    headers: headers,
    searchable: true,
    filters: {
      timestamp: {
        type: 'dateRange'
      },
      status: { label: "Status" },
      organization: { label: "Organization" },
      trigger_type: { label: "Trigger Type" }
    },
    transforms: {
      execution_id: (value, row) =>
        `<a href="${row.execution_link}" target="_blank" class="flex items-center gap-2 text-rewst-teal hover:text-rewst-light-teal"><span class="material-icons" style="font-size:16px;">open_in_new</span><span>View execution</span></a>`,
      parent_execution: (value, row) => {
        if (!row.parent_execution) return '—';
        return `<a href="${row.parent_execution.link}" target="_blank" class="flex items-center gap-2 text-rewst-teal hover:text-rewst-light-teal" title="${row.parent_execution.workflowName}"><span class="material-icons" style="font-size:16px;">open_in_new</span><span>View Parent</span></a>`;
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
        return value ? value.toLocaleString() : '0';
      },
      status: (value) => {
        if (["succeeded", "SUCCEEDED", "COMPLETED", "SUCCESS"].includes(value))
          return '<span class="badge badge-success">SUCCEEDED</span>';
        if (["FAILED", "failed"].includes(value))
          return '<span class="badge badge-error">FAILED</span>';
        if (["RUNNING", "running"].includes(value))
          return '<span class="badge badge-warning">RUNNING</span>';
        if (["CANCELED", "canceled", "CANCELLED", "cancelled"].includes(value))
          return '<span class="badge badge-warning">CANCELED</span>';
        return `<span class="badge">${value}</span>`;
      },
    },
    defaultSort: {
      column: 'timestamp',
      direction: 'desc'
    }
  });

  RewstDOM.place(table, "#workflow-executions");
}