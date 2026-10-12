import type {
  CustomerMarketingDraft,
  CustomerMarketingSchedule,
  CustomerScheduledJob,
  CustomerScheduledJobStatus,
} from '../../../shared/customer-marketing-types';
import type { CampaignCellSchedule } from '../../../shared/customer-marketing-campaign-map';

const JOB_STATUS_LABELS: Record<CustomerScheduledJobStatus, string> = {
  scheduled: 'Đã lên lịch',
  running: 'Đang soạn',
  draft_ready: 'Đã có bản nháp',
  failed: 'Chạy lỗi',
  blocked_quota: 'Hết hạn mức',
  cancelled: 'Đã huỷ',
};

const DRAFT_STATUS_LABELS: Record<CustomerMarketingDraft['status'], string> = {
  pending_review: 'Chờ bạn duyệt',
  ready_to_publish: 'Sẵn sàng đăng',
};

/** Removes `[proof-claim-id]` markers so copied text is ready to post. Keeps `[1]` or `[Link]`. */
export function stripProofTags(body: string): string {
  return body.replace(/[ \t]*\[[a-z0-9]+(?:-[a-z0-9]+)+\]/gi, '');
}

function draftFor(job: CustomerScheduledJob, drafts: CustomerMarketingDraft[]): CustomerMarketingDraft | undefined {
  return drafts.find((item) => item.id === job.draftId || item.jobId === job.id);
}

function byDueAt(a: CustomerScheduledJob, b: CustomerScheduledJob): number {
  return Date.parse(a.dueAt) - Date.parse(b.dueAt);
}

function JobRow({ job, drafts, showDate }: { job: CustomerScheduledJob; drafts: CustomerMarketingDraft[]; showDate: boolean }) {
  const due = new Date(job.dueAt);
  const draft = draftFor(job, drafts);
  return (
    <li className={`v2-campaign-board__job is-${job.status}`}>
      <time className="v2-campaign-board__job-due" dateTime={job.dueAt}>
        {showDate ? due.toLocaleString('vi-VN') : due.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
      </time>
      <span className="v2-campaign-board__job-title">{job.title}</span>
      <a className="v2-campaign-board__job-status" href={`#cmr-job-${job.id}`}>
        {JOB_STATUS_LABELS[job.status]}
      </a>
      {draft ? (
        <a className="v2-campaign-board__job-draft" href={`#cmr-draft-${draft.id}`}>
          Bản nháp: {DRAFT_STATUS_LABELS[draft.status]}
        </a>
      ) : null}
    </li>
  );
}

/** Scheduled jobs behind one board cell, with links to the job and its draft in the inspector. */
export function CellJobList({ linked }: { linked: CampaignCellSchedule }) {
  if (linked.jobs.length === 0) return null;
  return (
    <section className="v2-campaign-board__schedule" aria-label="Lịch chạy của việc này">
      <h5 className="v2-campaign-board__schedule-title">Lịch chạy</h5>
      <ul className="v2-campaign-board__jobs">
        {[...linked.jobs].sort(byDueAt).map((job) => (
          <JobRow key={job.id} job={job} drafts={linked.drafts} showDate />
        ))}
      </ul>
    </section>
  );
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** Day-by-day milestones of the approved plan, from the same jobs as the "Lịch chạy" rail. */
export function ScheduleTimeline({ schedule }: { schedule?: CustomerMarketingSchedule }) {
  const jobs = (schedule?.jobs ?? []).filter((job) => job.status !== 'cancelled').sort(byDueAt);
  if (jobs.length === 0) return null;

  const days = new Map<string, CustomerScheduledJob[]>();
  for (const job of jobs) {
    const key = dayKey(new Date(job.dueAt));
    days.set(key, [...(days.get(key) ?? []), job]);
  }

  return (
    <section className="v2-campaign-timeline" aria-label="Mốc thời gian">
      <h4 className="v2-campaign-timeline__title">Mốc thời gian</h4>
      <ol className="v2-campaign-timeline__days">
        {[...days.entries()].map(([key, dayJobs]) => (
          <li key={key} className="v2-campaign-timeline__day" data-day={key}>
            <span className="v2-campaign-timeline__date">
              {new Date(dayJobs[0].dueAt).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })}
            </span>
            <ul className="v2-campaign-board__jobs">
              {dayJobs.map((job) => (
                <JobRow key={job.id} job={job} drafts={schedule?.drafts ?? []} showDate={false} />
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
