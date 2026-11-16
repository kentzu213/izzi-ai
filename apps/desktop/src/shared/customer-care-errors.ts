// Public, fixed Customer Care error strings. None of them echo input, identity, or stored data,
// so main may forward them to the renderer and the renderer may show them verbatim.
export const CUSTOMER_CARE_AUTH_ERROR = 'Hãy đăng nhập và chọn workspace để dùng Chăm sóc khách hàng.';
export const CUSTOMER_CARE_UNAVAILABLE_ERROR =
  'Chưa kết nối được máy chủ izzi để xác minh workspace. Kiểm tra mạng rồi thử lại sau ít phút.';
export const CUSTOMER_CARE_FORBIDDEN_ERROR = 'Chỉ chủ sở hữu và quản lý workspace được thay đổi thiết lập chăm sóc khách hàng.';
export const CUSTOMER_CARE_ENCRYPTION_ERROR = 'Kho lưu trữ mã hóa chưa sẵn sàng trên thiết bị này.';
export const CUSTOMER_CARE_SAVE_ERROR = 'Chưa lưu được thiết lập chăm sóc khách hàng một cách bảo mật.';
export const CUSTOMER_CARE_INVALID_SETUP_ERROR = 'Thiết lập chưa hợp lệ. Kiểm tra các trường, nguồn và ngày duyệt.';
export const CUSTOMER_CARE_INVALID_INPUT_ERROR = 'Hội thoại chưa hợp lệ. Kiểm tra độ dài và nội dung các lượt trao đổi.';
export const CUSTOMER_CARE_SETUP_REQUIRED_ERROR = 'Hãy lưu thiết lập chăm sóc khách hàng hợp lệ trước khi tạo nháp.';
export const CUSTOMER_CARE_ACCESS_CHANGED_ERROR = 'Quyền workspace đã thay đổi trong lúc tạo nháp. Kết quả đã bị loại bỏ.';

export const CUSTOMER_CARE_PUBLIC_ERRORS: readonly string[] = [
  CUSTOMER_CARE_AUTH_ERROR,
  CUSTOMER_CARE_UNAVAILABLE_ERROR,
  CUSTOMER_CARE_FORBIDDEN_ERROR,
  CUSTOMER_CARE_ENCRYPTION_ERROR,
  CUSTOMER_CARE_SAVE_ERROR,
  CUSTOMER_CARE_INVALID_SETUP_ERROR,
  CUSTOMER_CARE_INVALID_INPUT_ERROR,
  CUSTOMER_CARE_SETUP_REQUIRED_ERROR,
  CUSTOMER_CARE_ACCESS_CHANGED_ERROR,
];
