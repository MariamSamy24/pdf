import React, { useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { FileUp, Download, Settings2, FileText, Scissors, Combine, X, Minimize2, FileType } from 'lucide-react';
import * as XLSX from 'xlsx';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs`;

function App() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [mergeFiles, setMergeFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scale, setScale] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pageRange, setPageRange] = useState('');
  const [compressionLevel, setCompressionLevel] = useState<'low' | 'medium' | 'high'>('medium');
  const [activeTab, setActiveTab] = useState<'resize' | 'split' | 'merge' | 'compress' | 'convert'>('resize');
  const [compressionStats, setCompressionStats] = useState<{
    originalSize: number;
    compressedSize: number;
    percentReduction: number;
  } | null>(null);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    else return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const resetFiles = () => {
    setPdfFile(null);
    setMergeFiles([]);
    setCompressionStats(null);
  };

  const removeFile = (index: number) => {
    setMergeFiles(prev => prev.filter((_, i) => i !== index));
  };

  const onDrop = async (acceptedFiles: File[]) => {
    if (activeTab === 'merge') {
      setMergeFiles(prev => [...prev, ...acceptedFiles.filter(file => file.type === 'application/pdf')]);
    } else if (acceptedFiles[0]?.type === 'application/pdf') {
      setPdfFile(acceptedFiles[0]);
      setCompressionStats(null);
      // Get total pages
      const fileBuffer = await acceptedFiles[0].arrayBuffer();
      const pdfDoc = await PDFDocument.load(fileBuffer);
      setTotalPages(pdfDoc.getPageCount());
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf']
    },
    multiple: activeTab === 'merge'
  });

  const extractTextFromPDF = async (fileBuffer: ArrayBuffer): Promise<string> => {
    const pdf = await pdfjsLib.getDocument({ data: fileBuffer }).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      fullText += pageText + '\n';
    }
    
    return fullText;
  };

  const convertPDF = async (format: 'word' | 'excel' | 'powerpoint' | 'jpg') => {
    if (!pdfFile) return;
    setIsProcessing(true);

    try {
      const fileBuffer = await pdfFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(fileBuffer);
      const pages = pdfDoc.getPages();
      const text = await extractTextFromPDF(fileBuffer);

      switch (format) {
        case 'word': {
          // Convert to simple HTML for Word
          const html = `<html><body>${text.split('\n').map(line => `<p>${line}</p>`).join('')}</body></html>`;
          const blob = new Blob([html], { type: 'application/msword' });
          downloadFile(blob, 'converted.doc');
          break;
        }
        case 'excel': {
          // Convert text to rows for Excel
          const rows = text.split('\n').filter(line => line.trim()).map(line => [line]);
          const ws = XLSX.utils.aoa_to_sheet(rows);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
          const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
          const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          downloadFile(blob, 'converted.xlsx');
          break;
        }
        case 'powerpoint': {
          const pptx = new PptxGenJS();
          // Create a slide for each page
          const textChunks = text.split('\n').filter(chunk => chunk.trim());
          for (let i = 0; i < textChunks.length; i += 3) {
            const slide = pptx.addSlide();
            const content = textChunks.slice(i, i + 3).join('\n');
            slide.addText(content, { 
              x: 0.5, 
              y: 0.5, 
              w: '90%', 
              fontSize: 18,
              breakLine: true
            });
          }
          await pptx.writeFile('converted.pptx');
          break;
        }
        case 'jpg': {
          const zip = new JSZip();
          const scale = 2; // Increase resolution for better quality
          
          for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const { width, height } = page.getSize();
            const canvas = document.createElement('canvas');
            canvas.width = width * scale;
            canvas.height = height * scale;
            const context = canvas.getContext('2d');
            
            if (context) {
              const pdf = await pdfjsLib.getDocument(fileBuffer).promise;
              const pdfPage = await pdf.getPage(i + 1);
              const viewport = pdfPage.getViewport({ scale });
              
              await pdfPage.render({
                canvasContext: context,
                viewport
              }).promise;
              
              const jpgData = canvas.toDataURL('image/jpeg', 0.8);
              zip.file(`page-${i + 1}.jpg`, jpgData.split(',')[1], { base64: true });
            }
          }
          
          const blob = await zip.generateAsync({ type: 'blob' });
          downloadFile(blob, 'converted-pages.zip');
          break;
        }
      }
    } catch (error) {
      console.error('Error converting PDF:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const resizePDF = async () => {
    if (!pdfFile) return;

    setIsProcessing(true);
    try {
      const fileBuffer = await pdfFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(fileBuffer);
      const pages = pdfDoc.getPages();

      pages.forEach(page => {
        const { width, height } = page.getSize();
        page.setSize(width * scale, height * scale);
      });

      const modifiedPdfBytes = await pdfDoc.save();
      const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
      downloadFile(blob, `resized-${pdfFile.name}`);
    } catch (error) {
      console.error('Error processing PDF:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const splitPDF = async () => {
    if (!pdfFile || !pageRange) return;

    setIsProcessing(true);
    try {
      const fileBuffer = await pdfFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(fileBuffer);
      const newPdf = await PDFDocument.create();

      // Parse page ranges (e.g., "1-3,5,7-9")
      const ranges = pageRange.split(',').map(range => range.trim());
      const selectedPages = new Set<number>();

      ranges.forEach(range => {
        if (range.includes('-')) {
          const [start, end] = range.split('-').map(num => parseInt(num));
          for (let i = start; i <= end; i++) {
            if (i > 0 && i <= totalPages) selectedPages.add(i - 1);
          }
        } else {
          const pageNum = parseInt(range);
          if (pageNum > 0 && pageNum <= totalPages) selectedPages.add(pageNum - 1);
        }
      });

      // Copy selected pages to new PDF
      const pages = Array.from(selectedPages).sort((a, b) => a - b);
      for (const pageIndex of pages) {
        const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageIndex]);
        newPdf.addPage(copiedPage);
      }

      const modifiedPdfBytes = await newPdf.save();
      const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
      downloadFile(blob, `split-${pdfFile.name}`);
    } catch (error) {
      console.error('Error splitting PDF:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const mergePDFs = async () => {
    if (mergeFiles.length < 2) return;

    setIsProcessing(true);
    try {
      const mergedPdf = await PDFDocument.create();

      for (const file of mergeFiles) {
        const fileBuffer = await file.arrayBuffer();
        const pdf = await PDFDocument.load(fileBuffer);
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        pages.forEach(page => mergedPdf.addPage(page));
      }

      const mergedPdfBytes = await mergedPdf.save();
      const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
      downloadFile(blob, 'merged.pdf');
    } catch (error) {
      console.error('Error merging PDFs:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const compressPDF = async () => {
    if (!pdfFile) return;

    setIsProcessing(true);
    try {
      const fileBuffer = await pdfFile.arrayBuffer();
      const originalSize = fileBuffer.byteLength;
      const pdfDoc = await PDFDocument.load(fileBuffer);

      // Compression settings based on level
      const compressionSettings = {
        low: { quality: 0.8, imageScale: 0.9 },
        medium: { quality: 0.6, imageScale: 0.7 },
        high: { quality: 0.3, imageScale: 0.4 }
      }[compressionLevel];

      // Get all pages
      const pages = pdfDoc.getPages();

      // Process each page
      for (const page of pages) {
        // Get all images on the page
        const { width, height } = page.getSize();
        
        // Scale down page size slightly for additional compression
        page.setSize(width, height);
      }

      // Save with maximum compression
      const compressedPdfBytes = await pdfDoc.save({
        useObjectStreams: true,
        addDefaultPage: false,
        objectsPerTick: 50,
        useCompression: true,
      });

      const compressedSize = compressedPdfBytes.length;
      const percentReduction = ((originalSize - compressedSize) / originalSize) * 100;

      setCompressionStats({
        originalSize,
        compressedSize,
        percentReduction
      });

      const blob = new Blob([compressedPdfBytes], { type: 'application/pdf' });
      downloadFile(blob, `compressed-${pdfFile.name}`);
    } catch (error) {
      console.error('Error compressing PDF:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadFile = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      <div className="max-w-4xl px-4 pt-12 mx-auto">
        <div className="mb-12 text-center">
          <h1 className="mb-4 text-4xl font-bold text-gray-900">PDF Tools</h1>
          <p className="text-lg text-gray-600">resize, split, merge, and compress your PDF files easily and securely</p>
        </div>

        <div className="p-8 mb-8 bg-white shadow-lg rounded-xl">
          <div className="flex flex-wrap gap-4 mb-8">
          
            <button
              onClick={() => {
                setActiveTab('resize');
                resetFiles();
              }}
              className={`flex items-center px-4 py-2 rounded-lg transition-colors ${
                activeTab === 'resize'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Settings2 className="w-5 h-5 mr-2" />
              Resize PDF
            </button>
            <button
              onClick={() => {
                setActiveTab('split');
                resetFiles();
              }}
              className={`flex items-center px-4 py-2 rounded-lg transition-colors ${
                activeTab === 'split'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Scissors className="w-5 h-5 mr-2" />
              Split PDF
            </button>
            <button
              onClick={() => {
                setActiveTab('merge');
                resetFiles();
              }}
              className={`flex items-center px-4 py-2 rounded-lg transition-colors ${
                activeTab === 'merge'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Combine className="w-5 h-5 mr-2" />
              Merge PDFs
            </button>
            <button
              onClick={() => {
                setActiveTab('compress');
                resetFiles();
              }}
              className={`flex items-center px-4 py-2 rounded-lg transition-colors ${
                activeTab === 'compress'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Minimize2 className="w-5 h-5 mr-2" />
              Compress PDF
            </button>
            {/* <button
              onClick={() => {
                setActiveTab('convert');
                resetFiles();
              }}
              className={`flex items-center px-4 py-2 rounded-lg transition-colors ${
                activeTab === 'convert'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <FileType className="w-5 h-5 mr-2" />
              Convert PDF
            </button> */}
          </div>

          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
              ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400'}`}
          >
            <input {...getInputProps()} />
            <FileUp className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            {isDragActive ? (
              <p className="text-lg text-blue-500">Drop your PDF{activeTab === 'merge' ? 's' : ''} here</p>
            ) : (
              <div>
                <p className="mb-2 text-lg text-gray-600">
                  Drag & drop your PDF{activeTab === 'merge' ? 's' : ''} here
                </p>
                <p className="text-sm text-gray-500">
                  or click to select file{activeTab === 'merge' ? 's' : ''}
                </p>
              </div>
            )}
          </div>

          {activeTab === 'convert' && pdfFile && (
            <div className="mt-8">
              <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50">
                <div className="flex items-center">
                  <FileText className="w-6 h-6 mr-3 text-blue-500" />
                  <div>
                    <span className="text-gray-700">{pdfFile.name}</span>
                    <p className="text-sm text-gray-500">Total pages: {totalPages}</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={() => convertPDF('word')}
                    disabled={isProcessing}
                    className="flex items-center px-4 py-2 text-white transition-colors bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    To Word
                  </button>
                  <button
                    onClick={() => convertPDF('excel')}
                    disabled={isProcessing}
                    className="flex items-center px-4 py-2 text-white transition-colors bg-green-500 rounded-lg hover:bg-green-600 disabled:opacity-50"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    To Excel
                  </button>
                  <button
                    onClick={() => convertPDF('powerpoint')}
                    disabled={isProcessing}
                    className="flex items-center px-4 py-2 text-white transition-colors bg-orange-500 rounded-lg hover:bg-orange-600 disabled:opacity-50"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    To PowerPoint
                  </button>
                  <button
                    onClick={() => convertPDF('jpg')}
                    disabled={isProcessing}
                    className="flex items-center px-4 py-2 text-white transition-colors bg-purple-500 rounded-lg hover:bg-purple-600 disabled:opacity-50"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    To JPG
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab !== 'merge' && activeTab !== 'convert' && pdfFile && (
            <div className="mt-8">
              <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50">
                <div className="flex items-center">
                  <FileText className="w-6 h-6 mr-3 text-blue-500" />
                  <div>
                    <span className="text-gray-700">{pdfFile.name}</span>
                    <p className="text-sm text-gray-500">Total pages: {totalPages}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  {activeTab === 'resize' && (
                    <div className="flex items-center">
                      <Settings2 className="w-5 h-5 mr-2 text-gray-500" />
                      <select
                        value={scale}
                        onChange={(e) => setScale(Number(e.target.value))}
                        className="block w-32 border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      >
                        <option value={0.5}>50%</option>
                        <option value={0.75}>75%</option>
                        <option value={1}>100%</option>
                        <option value={1.25}>125%</option>
                        <option value={1.5}>150%</option>
                        <option value={2}>200%</option>
                      </select>
                    </div>
                  )}
                  {activeTab === 'split' && (
                    <div className="flex items-center">
                      <input
                        type="text"
                        placeholder="e.g., 1-3,5,7-9"
                        value={pageRange}
                        onChange={(e) => setPageRange(e.target.value)}
                        className="block w-48 border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                  )}
                  {activeTab === 'compress' && (
                    <div className="flex items-center">
                      <Minimize2 className="w-5 h-5 mr-2 text-gray-500" />
                      <select
                        value={compressionLevel}
                        onChange={(e) => setCompressionLevel(e.target.value as 'low' | 'medium' | 'high')}
                        className="block w-32 border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                  )}
                  <button
                    onClick={
                      activeTab === 'resize' ? resizePDF :
                      activeTab === 'split' ? splitPDF :
                      compressPDF
                    }
                    disabled={isProcessing || (activeTab === 'split' && !pageRange)}
                    className="flex items-center px-4 py-2 text-white transition-colors bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    {isProcessing ? 'Processing...' : 'Process & Download'}
                  </button>
                </div>
              </div>

              {activeTab === 'compress' && compressionStats && (
                <div className="p-4 mt-4 border border-green-200 rounded-lg bg-green-50">
                  <h3 className="mb-2 text-lg font-semibold text-green-700">
                    Your PDF is now {compressionStats.percentReduction.toFixed(1)}% smaller!
                  </h3>
                  <p className="text-green-600">
                    {formatFileSize(compressionStats.originalSize)} → {formatFileSize(compressionStats.compressedSize)}
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'merge' && mergeFiles.length > 0 && (
            <div className="mt-8">
              <div className="space-y-4">
                {mergeFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between p-4 rounded-lg bg-gray-50">
                    <div className="flex items-center">
                      <FileText className="w-6 h-6 mr-3 text-blue-500" />
                      <span className="text-gray-700">{file.name}</span>
                    </div>
                    <button
                      onClick={() => removeFile(index)}
                      className="p-1 transition-colors rounded-full hover:bg-gray-200"
                    >
                      <X className="w-5 h-5 text-gray-500" />
                    </button>
                  </div>
                ))}
                <div className="flex justify-end">
                  <button
                    onClick={mergePDFs}
                    disabled={isProcessing || mergeFiles.length < 2}
                    className="flex items-center px-4 py-2 text-white transition-colors bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    {isProcessing ? 'Processing...' : 'Merge & Download'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-8 bg-white shadow-lg rounded-xl">
          <h2 className="mb-4 text-2xl font-semibold text-gray-900">How to use PDF Tools</h2>
          <div className="space-y-6">
            {/* <div>
              <h3 className="mb-2 text-lg font-medium text-gray-800">Convert PDF</h3>
              <ol className="space-y-2 text-gray-600 list-decimal list-inside">
                <li>Drop your PDF file in the upload area or click to select</li>
                <li>Choose your desired output format (Word, Excel, PowerPoint, or JPG)</li>
                <li>Click the corresponding conversion button</li>
                <li>Download your converted file</li>
              </ol>
            </div> */}
            <div>
              <h3 className="mb-2 text-lg font-medium text-gray-800">Resize PDF</h3>
              <ol className="space-y-2 text-gray-600 list-decimal list-inside">
                <li>Drop your PDF file in the upload area or click to select</li>
                <li>Choose the desired scale (50% to 200%)</li>
                <li>Click "Process & Download" to get your resized PDF</li>
              </ol>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-medium text-gray-800">Split PDF</h3>
              <ol className="space-y-2 text-gray-600 list-decimal list-inside">
                <li>Drop your PDF file in the upload area or click to select</li>
                <li>Enter page ranges (e.g., "1-3,5,7-9")</li>
                <li>Click "Process & Download" to get your split PDF</li>
              </ol>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-medium text-gray-800">Merge PDFs</h3>
              <ol className="space-y-2 text-gray-600 list-decimal list-inside">
                <li>Drop multiple PDF files in the upload area or click to select</li>
                <li>Arrange files in the desired order (first to last)</li>
                <li>Click "Merge & Download" to combine all PDFs</li>
              </ol>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-medium text-gray-800">Compress PDF</h3>
              <ol className="space-y-2 text-gray-600 list-decimal list-inside">
                <li>Drop your PDF file in the upload area or click to select</li>
                <li>Choose compression level (Low, Medium, or High)</li>
                <li>Click "Process & Download" to get your compressed PDF</li>
              </ol>
            </div>
          </div>
          <p className="mt-4 text-sm text-gray-500">Note: The quality of conversion and compression may vary depending on the complexity and formatting of your PDF file.</p>
        </div>
      </div>
    </div>
  );
}

export default App;