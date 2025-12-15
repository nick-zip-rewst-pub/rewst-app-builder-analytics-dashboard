/**
 * Insights Dashboard
 * @fileoverview Sub page for dashboard that analyzes execution data and provides actionable recommendations
 * @author Nick Zipse <nick.zipse@rewst.com>
 * @version 1.3.3
 */

function renderInsightsDashboard() {
  if (!window.dashboardData) {
    console.error('No dashboard data available');
    return;
  }

  const { workflows, executions, forms } = window.dashboardData;
  const filteredExecutions = getFilteredExecutions();

  // Check if we have enough data (at least 7 days worth)
  const dateRange = getDateRange(filteredExecutions);
  const daysDiff = dateRange.days;

  // Update date range display
  document.getElementById('insights-date-range').innerHTML = `
    <p class="text-sm text-rewst-gray">Insights based on <strong>${dateRange.start}</strong> to <strong>${dateRange.end}</strong> (${daysDiff} days)</p>
  `;

  // Show warning if less than 7 days
  if (daysDiff < 7) {
    document.getElementById('insights-warning').style.display = 'block';
  } else {
    document.getElementById('insights-warning').style.display = 'none';
  }

  // Generate insights
  const insights = generateInsights(workflows, filteredExecutions, forms);

  // Render summary cards
  renderInsightSummaryCards(insights);

  // Render insight sections
  renderInsightSection('attention', insights.attention);
  renderInsightSection('optimization', insights.optimization);
  renderInsightSection('activity', insights.activity);
  renderMissingDataTable(insights.missing);
}

/**
 * Get date range from executions
 */
function getDateRange(executions) {
  if (executions.length === 0) {
    return { start: 'N/A', end: 'N/A', days: 0 };
  }

  const timestamps = executions
    .map(e => parseInt(e.createdAt))
    .filter(t => !isNaN(t))
    .sort((a, b) => a - b);

  const startDate = new Date(timestamps[0]);
  const endDate = new Date(timestamps[timestamps.length - 1]);
  const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

  const formatDate = (date) => {
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  };

  return {
    start: formatDate(startDate),
    end: formatDate(endDate),
    days: daysDiff
  };
}

/**
 * Generate all insights from data
 */
function generateInsights(workflows, executions, forms) {
  const insights = {
    attention: [],
    optimization: [],
    activity: [],
    missing: []
  };

  // Filter out OPTION_GENERATOR workflows - they don't save time and shouldn't appear in insights
  const standardWorkflows = workflows.filter(w => w.type !== 'OPTION_GENERATOR');
  const standardExecutions = executions.filter(e => e.workflow?.type !== 'OPTION_GENERATOR');

  // Create a Set of valid workflow IDs from standard workflows only
  const validWorkflowIds = new Set(standardWorkflows.map(w => w.id));

  // Group executions by workflow
  const workflowStats = {};
  standardExecutions.forEach(exec => {
    const wfId = exec.workflow?.id;
    if (!wfId) return;

    // Skip if workflow doesn't exist in getAllWorkflows (deleted/no access)
    if (!validWorkflowIds.has(wfId)) return;

    if (!workflowStats[wfId]) {
      workflowStats[wfId] = {
        id: wfId,
        name: exec.workflow?.name || 'Unknown Workflow',
        link: exec.workflow?.link, // Use link from execution object
        executions: [],
        succeeded: 0,
        failed: 0,
        runtimes: []
      };
    }

    workflowStats[wfId].executions.push(exec);

    if (['succeeded', 'SUCCEEDED', 'COMPLETED', 'SUCCESS'].includes(exec.status)) {
      workflowStats[wfId].succeeded++;
    } else if (['FAILED', 'failed'].includes(exec.status)) {
      workflowStats[wfId].failed++;
    }

    // Track runtime
    if (exec.createdAt && exec.updatedAt) {
      const runtime = (parseInt(exec.updatedAt) - parseInt(exec.createdAt)) / 1000;
      workflowStats[wfId].runtimes.push(runtime);
    }
  });

  // 🚨 NEEDS ATTENTION: High failure rate
  Object.values(workflowStats).forEach(wf => {
    const total = wf.executions.length;
    if (total < 5) return; // Need at least 5 executions to be meaningful

    const failureRate = (wf.failed / total) * 100;
    if (failureRate >= 30) { // 30% or higher failure rate
      insights.attention.push({
        type: 'high_failure_rate',
        workflowId: wf.id,
        workflowName: wf.name,
        workflowLink: wf.link,
        title: `${wf.name} has ${failureRate.toFixed(1)}% failure rate`,
        description: `${wf.failed} failures out of ${total} executions in this period`,
        severity: failureRate >= 50 ? 'critical' : 'high',
        failureRate: failureRate,
        failedCount: wf.failed
      });
    }
  });

  // Sort by failure rate (highest first), then by failed count
  insights.attention.sort((a, b) => {
    if (b.failureRate !== a.failureRate) {
      return b.failureRate - a.failureRate;
    }
    return b.failedCount - a.failedCount;
  });

  // 🚨 NEEDS ATTENTION: Consecutive failures
  Object.values(workflowStats).forEach(wf => {
    const sortedExecs = wf.executions.sort((a, b) => 
      parseInt(b.createdAt) - parseInt(a.createdAt)
    );

    let consecutiveFailures = 0;
    for (let i = 0; i < Math.min(5, sortedExecs.length); i++) {
      if (['FAILED', 'failed'].includes(sortedExecs[i].status)) {
        consecutiveFailures++;
      } else {
        break;
      }
    }

    if (consecutiveFailures >= 3) {
      insights.attention.push({
        type: 'consecutive_failures',
        workflowId: wf.id,
        workflowName: wf.name,
        workflowLink: wf.link,
        title: `${wf.name} failed ${consecutiveFailures} times consecutively`,
        description: `Last ${consecutiveFailures} executions all failed`,
        severity: 'high',
        failureRate: 0, // For sorting purposes
        failedCount: consecutiveFailures
      });
    }
  });

  // ⚠️ OPTIMIZATION: Slow execution times
  Object.values(workflowStats).forEach(wf => {
    if (wf.runtimes.length < 5) return;

    const avgRuntime = wf.runtimes.reduce((a, b) => a + b, 0) / wf.runtimes.length;
    
    if (avgRuntime > 60) { // More than 60 seconds
      insights.optimization.push({
        type: 'slow_execution',
        workflowId: wf.id,
        workflowName: wf.name,
        workflowLink: wf.link,
        title: `${wf.name} has slow execution time`,
        description: `Average runtime: ${avgRuntime.toFixed(1)}s across ${wf.runtimes.length} executions`,
        severity: 'medium',
        avgRuntime: avgRuntime
      });
    }
  });

  // Sort optimization by slowest first
  insights.optimization.sort((a, b) => b.avgRuntime - a.avgRuntime);

  // 🚨 NEEDS ATTENTION: Sudden spike in task usage (per workflow)
  Object.values(workflowStats).forEach(wf => {
    const execs = wf.executions;
    if (execs.length < 10) return; // Need enough data for comparison

    // Sort by date
    const sorted = [...execs].sort((a, b) => parseInt(a.createdAt) - parseInt(b.createdAt));

    // Split into historical (first 70%) and recent (last 30%)
    const splitIndex = Math.floor(sorted.length * 0.7);
    const historical = sorted.slice(0, splitIndex);
    const recent = sorted.slice(splitIndex);

    if (historical.length < 5 || recent.length < 3) return;

    // Calculate average tasks per execution
    const historicalAvgTasks = historical.reduce((sum, e) => sum + (e.tasksUsed || 0), 0) / historical.length;
    const recentAvgTasks = recent.reduce((sum, e) => sum + (e.tasksUsed || 0), 0) / recent.length;

    // Spike: recent avg is 2x+ historical avg (and historical avg > 0)
    if (historicalAvgTasks > 0 && recentAvgTasks >= historicalAvgTasks * 2) {
      const increasePercent = ((recentAvgTasks - historicalAvgTasks) / historicalAvgTasks) * 100;
      insights.attention.push({
        type: 'task_usage_spike',
        workflowId: wf.id,
        workflowName: wf.name,
        workflowLink: wf.link,
        title: `${wf.name} task usage spiked ${increasePercent.toFixed(0)}%`,
        description: `Recent avg: ${recentAvgTasks.toFixed(1)} tasks/run vs historical: ${historicalAvgTasks.toFixed(1)} tasks/run`,
        severity: increasePercent >= 200 ? 'critical' : 'high',
        failureRate: 0,
        failedCount: 0,
        increasePercent
      });
    }
  });

  // 🚨 NEEDS ATTENTION: Sudden spike in aggregate task usage
  if (executions.length >= 20) {
    const sorted = [...executions].sort((a, b) => parseInt(a.createdAt) - parseInt(b.createdAt));
    const splitIndex = Math.floor(sorted.length * 0.7);
    const historical = sorted.slice(0, splitIndex);
    const recent = sorted.slice(splitIndex);

    const historicalTotalTasks = historical.reduce((sum, e) => sum + (e.tasksUsed || 0), 0);
    const recentTotalTasks = recent.reduce((sum, e) => sum + (e.tasksUsed || 0), 0);

    // Normalize by execution count to get per-execution average
    const historicalAvg = historicalTotalTasks / historical.length;
    const recentAvg = recentTotalTasks / recent.length;

    if (historicalAvg > 0 && recentAvg >= historicalAvg * 1.5) {
      const increasePercent = ((recentAvg - historicalAvg) / historicalAvg) * 100;
      insights.attention.push({
        type: 'aggregate_task_spike',
        workflowId: null,
        workflowName: 'All Workflows',
        workflowLink: null,
        title: `Overall task usage up ${increasePercent.toFixed(0)}%`,
        description: `Recent period: ${recentAvg.toFixed(1)} tasks/execution vs historical: ${historicalAvg.toFixed(1)} tasks/execution`,
        severity: increasePercent >= 100 ? 'high' : 'medium',
        failureRate: 0,
        failedCount: 0,
        increasePercent
      });
    }
  }

  // 🚨 NEEDS ATTENTION: Sudden drop in executions for consistent workflows
  Object.values(workflowStats).forEach(wf => {
    const execs = wf.executions;
    if (execs.length < 10) return;

    // Sort by date
    const sorted = [...execs].sort((a, b) => parseInt(a.createdAt) - parseInt(b.createdAt));

    // Split into historical (first 70%) and recent (last 30%)
    const splitIndex = Math.floor(sorted.length * 0.7);
    const historical = sorted.slice(0, splitIndex);
    const recent = sorted.slice(splitIndex);

    if (historical.length < 5 || recent.length < 2) return;

    // Calculate executions per day
    const historicalStart = parseInt(historical[0].createdAt);
    const historicalEnd = parseInt(historical[historical.length - 1].createdAt);
    const historicalDays = Math.max(1, (historicalEnd - historicalStart) / (1000 * 60 * 60 * 24));
    const historicalRate = historical.length / historicalDays;

    const recentStart = parseInt(recent[0].createdAt);
    const recentEnd = parseInt(recent[recent.length - 1].createdAt);
    const recentDays = Math.max(1, (recentEnd - recentStart) / (1000 * 60 * 60 * 24));
    const recentRate = recent.length / recentDays;

    // Drop: recent rate is less than 50% of historical rate (and was running at least once per day)
    if (historicalRate >= 1 && recentRate < historicalRate * 0.5) {
      const dropPercent = ((historicalRate - recentRate) / historicalRate) * 100;
      insights.attention.push({
        type: 'execution_drop',
        workflowId: wf.id,
        workflowName: wf.name,
        workflowLink: wf.link,
        title: `${wf.name} executions dropped ${dropPercent.toFixed(0)}%`,
        description: `Recent: ${recentRate.toFixed(1)}/day vs historical: ${historicalRate.toFixed(1)}/day`,
        severity: dropPercent >= 80 ? 'high' : 'medium',
        failureRate: 0,
        failedCount: 0,
        dropPercent
      });
    }
  });

  // 🚨 NEEDS ATTENTION: Sudden drop in task usage (per workflow) - especially to zero
  Object.values(workflowStats).forEach(wf => {
    const execs = wf.executions;
    if (execs.length < 10) return;

    // Sort by date
    const sorted = [...execs].sort((a, b) => parseInt(a.createdAt) - parseInt(b.createdAt));

    // Split into historical (first 70%) and recent (last 30%)
    const splitIndex = Math.floor(sorted.length * 0.7);
    const historical = sorted.slice(0, splitIndex);
    const recent = sorted.slice(splitIndex);

    if (historical.length < 5 || recent.length < 3) return;

    // Calculate average tasks per execution
    const historicalAvgTasks = historical.reduce((sum, e) => sum + (e.tasksUsed || 0), 0) / historical.length;
    const recentAvgTasks = recent.reduce((sum, e) => sum + (e.tasksUsed || 0), 0) / recent.length;

    // Only flag if historical avg was meaningful (at least 5 tasks on average)
    if (historicalAvgTasks < 5) return;

    // Critical: dropped to zero or near-zero (less than 1 task avg)
    if (recentAvgTasks < 1) {
      insights.attention.push({
        type: 'task_usage_zero',
        workflowId: wf.id,
        workflowName: wf.name,
        workflowLink: wf.link,
        title: `${wf.name} task usage dropped to zero`,
        description: `Was using ${historicalAvgTasks.toFixed(1)} tasks/run, now ${recentAvgTasks.toFixed(1)} - workflow may be broken`,
        severity: 'critical',
        failureRate: 0,
        failedCount: 0,
        dropPercent: 100
      });
    }
    // High: dropped by 50%+ (but not to zero)
    else if (recentAvgTasks < historicalAvgTasks * 0.5) {
      const dropPercent = ((historicalAvgTasks - recentAvgTasks) / historicalAvgTasks) * 100;
      insights.attention.push({
        type: 'task_usage_drop',
        workflowId: wf.id,
        workflowName: wf.name,
        workflowLink: wf.link,
        title: `${wf.name} task usage dropped ${dropPercent.toFixed(0)}%`,
        description: `Recent avg: ${recentAvgTasks.toFixed(1)} tasks/run vs historical: ${historicalAvgTasks.toFixed(1)} tasks/run`,
        severity: dropPercent >= 80 ? 'high' : 'medium',
        failureRate: 0,
        failedCount: 0,
        dropPercent
      });
    }
  });

  // 💜 LOW ACTIVITY: Workflows with no executions (limit to 5)
  const executedWorkflowIds = new Set(Object.keys(workflowStats));
  const unusedWorkflows = [];
  workflows.forEach(wf => {
    if (!executedWorkflowIds.has(wf.id)) {
      unusedWorkflows.push({
        type: 'no_executions',
        workflowId: wf.id,
        workflowName: wf.name,
        workflowLink: wf.link,
        title: `${wf.name} has no executions`,
        description: `No executions in the selected date range`,
        severity: 'low'
      });
    }
  });

  // 💜 LOW ACTIVITY: Forms with no submissions (limit to 5)
  const submittedFormIds = new Set(
    executions
      .filter(e => e.triggerInfo?.type === 'Form Submission')
      .map(e => e.triggerInfo?.formId || e.form?.id)
      .filter(Boolean)
  );

  const unusedForms = [];
  forms.forEach(form => {
    if (!submittedFormIds.has(form.id)) {
      unusedForms.push({
        type: 'no_form_submissions',
        formId: form.id,
        formName: form.name,
        formLink: form.link,
        title: `${form.name} has no submissions`,
        description: `No form submissions in the selected date range`,
        severity: 'low'
      });
    }
  });

  // Combine and limit total low activity insights to 10 (5 workflows + 5 forms max)
  insights.activity = [...unusedWorkflows.slice(0, 5), ...unusedForms.slice(0, 5)];

  // 💖 MISSING DATA: Workflows missing time savings
  workflows.forEach(wf => {
    const hasTimeSavings = wf.humanSecondsSaved && wf.humanSecondsSaved > 0;
    if (!hasTimeSavings) {
      // Count executions for this workflow (only if it exists in workflowStats)
      const executionCount = workflowStats[wf.id]?.executions.length || 0;
      
      insights.missing.push({
        type: 'missing_time_savings',
        workflowId: wf.id,
        workflowName: wf.name,
        workflowLink: wf.link,
        executionCount: executionCount,
        severity: 'info'
      });
    }
  });

  return insights;
}

/**
 * Render summary metric cards
 */
function renderInsightSummaryCards(insights) {
  RewstDOM.place(RewstDOM.createMetricCard({
    title: 'Needs Attention',
    subtitle: 'Issues to review',
    value: insights.attention.length,
    icon: 'error',
    color: 'bask',
    solidBackground: true
  }), '#insight-metric-attention');

  RewstDOM.place(RewstDOM.createMetricCard({
    title: 'Optimization',
    subtitle: 'Performance issues',
    value: insights.optimization.length,
    icon: 'schedule',
    color: 'orange',
    solidBackground: true
  }), '#insight-metric-optimization');

  RewstDOM.place(RewstDOM.createMetricCard({
    title: 'Low Activity',
    subtitle: 'Unused resources',
    value: insights.activity.length,
    icon: 'bedtime',
    color: 'snooze',
    solidBackground: true
  }), '#insight-metric-activity');

  RewstDOM.place(RewstDOM.createMetricCard({
    title: 'Missing Time Savings',
    subtitle: 'Incomplete metadata',
    value: insights.missing.length,
    icon: 'timer_off',
    color: 'fandango',
    solidBackground: true
  }), '#insight-metric-missing');
}

/**
 * Render a section of insights (2 columns for all sections)
 */
function renderInsightSection(sectionName, insights) {
  const container = document.getElementById(`insights-${sectionName}-cards`);
  
  if (insights.length === 0) {
    // Show empty state
    container.innerHTML = `
      <div class="insight-empty-state">
        <span class="material-icons">check_circle</span>
        <p class="insight-empty-state-text">No issues found - everything looks good!</p>
      </div>
    `;
    return;
  }

  // Color mapping
  const colorMap = {
    attention: 'bask',
    optimization: 'orange',
    activity: 'snooze',
    missing: 'fandango'
  };

  const color = colorMap[sectionName];

  // 2-column grid for all sections
  const gridClass = 'grid grid-cols-1 lg:grid-cols-2 gap-4';

  const cardsHtml = insights.map(insight => {
    // Low activity items should open in new tab
    const isExternal = insight.type === 'no_executions' || insight.type === 'no_form_submissions';
    
    // Get the correct link
    const link = insight.workflowLink || insight.formLink;
    
    const clickHandler = isExternal 
      ? `window.open('${link}', '_blank')`
      : `navigateToWorkflowDetail('${insight.workflowId}')`;

    return `
      <div class="card card-accent-${color} insight-card insight-card-clickable" onclick="${clickHandler}">
        <div class="insight-card-content">
          <h4 class="insight-card-title">${insight.title}</h4>
          <p class="insight-card-description">${insight.description}</p>
        </div>
        <div class="insight-card-footer">
          <span class="material-icons text-rewst-${color} insight-card-arrow">arrow_forward</span>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="${gridClass}">${cardsHtml}</div>`;
}

/**
 * Render missing data as a table instead of cards
 */
function renderMissingDataTable(insights) {
  const container = document.getElementById('insights-missing-cards');
  
  if (insights.length === 0) {
    container.innerHTML = `
      <div class="insight-empty-state">
        <span class="material-icons">check_circle</span>
        <p class="insight-empty-state-text">All workflows have time savings data - great job!</p>
      </div>
    `;
    return;
  }

  // Create table data
  const tableData = insights.map(insight => ({
    workflow_name: insight.workflowName,
    execution_count: insight.executionCount,
    workflow_link: insight.workflowLink,
    action: 'Open'
  }));

  // Render table
  const table = RewstDOM.createTable(tableData, {
    columns: ['workflow_name', 'execution_count', 'action'],
    headers: {
      workflow_name: 'Workflow Name',
      execution_count: 'Executions',
      action: 'Action'
    },
    transforms: {
      execution_count: (value) => {
        return value || '0';
      },
      action: (value, row) => {
        return `<button 
          class="btn-tertiary btn-sm" 
          onclick="window.open('${row.workflow_link}', '_blank')"
        >
          <span class="material-icons text-sm">open_in_new</span>
        </button>`;
      }
    },
    sortable: true,
    searchable: true,
    pagination: 10,
    defaultSort: {
      column: 'execution_count',
      direction: 'desc'
    }
  });

  container.innerHTML = '';
  container.appendChild(table);
}