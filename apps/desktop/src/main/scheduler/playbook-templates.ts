/**
 * Built-in playbook templates (Requirement R2.1, and the "out of scope" note in the spec: steps
 * ship as templates in this iteration).
 *
 * These mirror a pipeline that has been verified end-to-end in production: it writes the content,
 * generates the illustration, publishes the article, publishes the social post with that image, and
 * comments the article link back under the post. The gates listed here are the ones the pipeline
 * itself enforces — they are shown to the user so they know what protection they get.
 *
 * `workingDir` is empty on purpose: it is the folder the user points at when creating the schedule,
 * so no personal path is baked into the product.
 */
import type { Playbook } from './playbook-types.js';

/** Placeholder the UI replaces with the user's chosen pipeline folder. */
export const WORKING_DIR_PLACEHOLDER = '';

const GATES_SOCIAL = [
  'Không đăng khi chưa có ảnh minh hoạ hợp lệ (đúng kích thước tối thiểu)',
  'Không đăng nếu nội dung còn URL — link chỉ đặt ở bình luận',
  'Dừng cả pipeline nếu bước đăng bài viết thất bại (không đăng social thiếu link)',
  'Bỏ qua nội dung đã đăng trước đó (chống trùng)',
];

export const BUILTIN_PLAYBOOKS: Playbook[] = [
  {
    id: 'trending-review-daily',
    name: 'Bài review nguồn trending (hằng ngày)',
    summary:
      'Chọn một chủ đề trending chưa dùng → viết bài review → tạo ảnh → đăng bài viết → đăng social kèm ảnh → bình luận link.',
    workingDir: WORKING_DIR_PLACEHOLDER,
    defaultTimeoutMs: 30 * 60_000,
    gates: GATES_SOCIAL,
    steps: [
      {
        id: 'pipeline-daily',
        label: 'Chạy pipeline review hằng ngày',
        command: 'node',
        args: ['scripts/run-github-trending-pipeline.mjs', '--kind=daily'],
        timeoutMs: 30 * 60_000,
        requiresProfiles: ['../profile-github-facebook-chatgpt-izziapi'],
      },
    ],
  },
  {
    id: 'trending-review-weekly',
    name: 'Bài tổng hợp nguồn trending (hằng tuần)',
    summary: 'Bản tổng hợp nhiều chủ đề trong tuần, cùng chuỗi cổng chất lượng như bản hằng ngày.',
    workingDir: WORKING_DIR_PLACEHOLDER,
    defaultTimeoutMs: 45 * 60_000,
    gates: GATES_SOCIAL,
    steps: [
      {
        id: 'pipeline-weekly',
        label: 'Chạy pipeline tổng hợp tuần',
        command: 'node',
        args: ['scripts/run-github-trending-pipeline.mjs', '--kind=weekly-top5'],
        timeoutMs: 45 * 60_000,
        requiresProfiles: ['../profile-github-facebook-chatgpt-izziapi'],
      },
    ],
  },
  {
    id: 'community-source-session',
    name: 'Phiên khai thác nguồn cộng đồng',
    summary:
      'Quét các nhóm nguồn (ưu tiên nội dung kỹ thuật) → viết lại thành bài có góc nhìn riêng → tạo ảnh → đăng.',
    workingDir: WORKING_DIR_PLACEHOLDER,
    defaultTimeoutMs: 30 * 60_000,
    gates: GATES_SOCIAL,
    steps: [
      {
        id: 'pipeline-community',
        label: 'Chạy pipeline nguồn cộng đồng',
        command: 'node',
        args: ['scripts/run-scheduled-pipeline.mjs'],
        timeoutMs: 30 * 60_000,
        requiresProfiles: ['../profile-facebook'],
      },
    ],
  },
];

export function findPlaybook(id: string): Playbook | null {
  return BUILTIN_PLAYBOOKS.find((p) => p.id === id) ?? null;
}
