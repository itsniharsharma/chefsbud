import api from './api'

export const demoService = {
  book(payload) {
    return api.post('/demo/book', payload).then((response) => response.data)
  },
}
