import mongoose from 'mongoose'

const TranscriptionSchema = new mongoose.Schema({
  audio_url: String,
  transcription: String,
  created_at: { type: Date, default: Date.now },
})

export default mongoose.model('Transcription', TranscriptionSchema)
