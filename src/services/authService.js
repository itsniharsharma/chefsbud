import api from './api'

export const authService = {
  initiateRegistration(payload) {
    return api.post('/auth/register/initiate', payload).then((response) => response.data)
  },
  verifyRegistration(payload) {
    return api.post('/auth/register/verify', payload).then((response) => response.data)
  },
  resendRegistrationCode(payload) {
    return api.post('/auth/register/resend-code', payload).then((response) => response.data)
  },
  login(payload) {
    return api.post('/auth/login', payload).then((response) => response.data)
  },
  staffLogin(payload) {
    return api.post('/auth/staff/login', payload).then((response) => response.data)
  },
  me() {
    return api.get('/auth/me').then((response) => response.data)
  },
  updateOwnerCredentials(payload) {
    return api.put('/auth/me/credentials', payload).then((response) => response.data)
  },
  logout() {
    return api.post('/auth/logout').then((response) => response.data)
  },
}
