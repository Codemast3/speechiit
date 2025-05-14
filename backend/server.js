if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config()
}

const express = require('express')
const cors = require('cors')
const multer = require('multer')
const fs = require('fs')
const mongoose = require('mongoose')
const axios = require('axios')
const { createClient: createSupabaseClient } = require('@supabase/supabase-js')
const { createClient: createDeepgramClient } = require('@deepgram/sdk')

const app = express()
const upload = multer({ dest: 'uploads/' })

const dburl = process.env.DB_URL || 'mongodb://localhost:27017/speechdb'
// const dburl = 'mongodb://localhost:27017/speechdb'

// MongoDB Connection
async function connectToMongoDB() {
  try {
    await mongoose.connect(dburl, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    console.log('✅ Connected to MongoDB')
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error)
  }
}
connectToMongoDB()

// MongoDB Schema & Model
const taskSchema = new mongoose.Schema({
  audio_url: String,
  transcription: String,
  user_id: String,
  createdAt: { type: Date, default: Date.now },
})
const Task = mongoose.model('Task', taskSchema)

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use('/uploads', express.static('uploads'))

// Upload Audio File
app.post('/upload', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  res
    .status(200)
    .json({ message: 'File uploaded successfully', file: req.file })
})

// Transcription Route
app.post('/transcription', upload.single('audio'), async (req, res) => {
  if (!req.file)
    return res.status(400).json({ error: 'No audio file uploaded' })
  const userId = req.body.userId // Ensure userId is being passed
  const filePath = req.file.path

  try {
    const fileStream = fs.createReadStream(filePath)
    const uploadResponse = await axios.post(
      'https://api.assemblyai.com/v2/upload',
      fileStream,
      {
        headers: {
          authorization: process.env.ASSEMBLYAI_API_KEY,
          'Transfer-Encoding': 'chunked',
        },
      }
    )
    const assemblyUploadUrl = uploadResponse.data.upload_url

    const transcriptResponse = await axios.post(
      'https://api.assemblyai.com/v2/transcript',
      { audio_url: assemblyUploadUrl },
      { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } }
    )
    const transcriptId = transcriptResponse.data.id

    // Polling for transcription completion
    let transcriptionResult
    let retries = 20
    while (retries--) {
      const pollingResponse = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } }
      )
      transcriptionResult = pollingResponse.data
      if (transcriptionResult.status === 'completed') break
      if (transcriptionResult.status === 'error')
        throw new Error('Transcription failed.')
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }

    fs.unlinkSync(filePath) // Delete uploaded file

    // Save transcription in MongoDB
    const newTask = new Task({
      audio_url: `/uploads/${req.file.filename}`,
      transcription: transcriptionResult.text,
      user_id: userId,
    })
    await newTask.save()

    res.status(200).json({
      message: 'Transcription saved successfully',
      transcription: transcriptionResult.text,
    })
  } catch (error) {
    console.error('❌ Transcription Error:', error)
    res.status(500).json({ error: 'Transcription process failed.' })
  }
})

// Get User Transcriptions
app.get('/user-transcriptions', async (req, res) => {
  const userId = req.query.userId
  if (!userId) return res.status(400).json({ error: 'User ID is required' })
  try {
    const userTranscriptions = await Task.find({ user_id: userId }).sort({
      createdAt: -1,
    })
    res.status(200).json(userTranscriptions)
  } catch (error) {
    console.error('❌ Fetching Transcriptions Error:', error)
    res.status(500).json({ error: 'Failed to fetch transcriptions' })
  }
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`))
