import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

api.interceptors.response.use(
  (response) => {
    if (response.data && response.data.success === false) {
      return Promise.reject(new Error(response.data.error?.message || '请求失败'));
    }
    return response.data;
  },
  (error) => {
    const msg = error.response?.data?.error?.message || error.message || '网络错误';
    return Promise.reject(new Error(msg));
  }
);

export default api;
