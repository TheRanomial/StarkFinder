/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Play, Edit2, Shield, CheckCircle, XCircle  } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion"


interface DeploymentResponse {
  success: boolean;
  contractAddress?: string;
  classHash?: string;
  transactionHash?: string;
  error?: string;
  details?: string;
}

interface ContractCodeProps {
  nodes: any; // Update with proper type if available
  edges: any; // Update with proper type if available
  flowSummary: any; // Update with proper type if available
  sourceCode: string;
  setSourceCode: (code: string) => void;
  setDisplayState: (state: any) => void; // Update with proper type if available
}

const ContractCode: React.FC<ContractCodeProps> = ({
  nodes,
  edges,
  flowSummary,
  sourceCode,
  setSourceCode,
  setDisplayState,
}) => {
  const [editable, setEditable] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<DeploymentResponse | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const addLog = (message: string): void => {
    setLogs((prev) => [
      ...prev,
      `${new Date().toISOString().split("T")[1].split(".")[0]} - ${message}`,
    ]);
  };

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [sourceCode, logs]);

  const compileContractHandler = async (): Promise<void> => {
    setIsLoading(true);
    setResult(null);
    setLogs([]);
    addLog("Starting deployment process...");

    try {
      addLog("Compiling and deploying contract...");

      const response = await fetch("/api/deploy-contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractName: "contractww_contractww" }),
      });

      const data: DeploymentResponse = await response.json();
      setResult(data);

      if (data.success) {
        addLog("✅ Deployment successful!");
        addLog(`📄 Contract Address: ${data.contractAddress}`);
        addLog(`🔗 Transaction Hash: ${data.transactionHash}`);
      } else {
        addLog(`❌ Error: ${data.error}`);
        if (data.details) {
          addLog(`📝 Details: ${data.details}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      addLog(`❌ Error: ${errorMessage}`);
      setResult({
        success: false,
        error: "Deployment failed",
        details: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const auditCodeHandler = async (): Promise<void> => {
    const fetchStreamedData = async () => {
      const response = await fetch("/api/generate-contract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sourceCode }),
      });
      setSourceCode("");
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let done = false;
        while (!done) {
          const { value, done: isDone } = await reader.read();
          done = isDone;
          if (value) {
            const newSourceCode = sourceCode + decoder.decode(value);
            setSourceCode(newSourceCode);
          }
        }
      }
    };

    fetchStreamedData();
  };

  return (
    <motion.div
    initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
     className="flex flex-col gap-8 p-8 bg-navy-900 rounded-2xl shadow-2xl border border-navy-700 relative min-h-[500px] max-h-[80vh] overflow-y-auto"
      style={{
        background: "linear-gradient(to bottom right, #0a192f, #112240, #1a365f)",
        boxShadow: "0 0 20px rgba(100, 255, 218, 0.1)",
      }}
    >
      <div className="flex flex-col gap-8 pb-24">
        <motion.div className="text-4xl font-bold text-cyan-300"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}>Contract Code</motion.div>
        <div
          ref={containerRef}
          className={`text-black relative overflow-hidden rounded-xl bg-navy-800 border border-navy-600" ${
            editable ? "bg-yellow-200" : "bg-yellow-100"
          }`}
        >
          <pre className="p-6 overflow-y-auto max-h-[60vh]">
            <code
              contentEditable={editable}
              spellCheck="false"
              style={{
                outline: "none",
                border: "none",
                whiteSpace: "pre-wrap",
                wordWrap: "break-word",
                padding: "0",
              }}
              suppressContentEditableWarning={true}
              onBlur={(e) => setSourceCode(e.currentTarget.textContent || "")}
            >
              {sourceCode}
            </code>
          </pre>
        </div>

        <div className="flex gap-4 mt-2">
          <button 
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transform hover:scale-105 focus:outline-none ocus:ring-2 focus:ring-cyan-400 focus:ring-opacity-50 font-bold ${
              isLoading || editable 
                ? 'bg-gray-500 cursor-not-allowed' 
                : 'bg-cyan-500 hover:bg-cyan-600 text-black'
            }`}
            style={{
              boxShadow: "0 0 15px rgba(100, 255, 218, 0.3)",
            }}
            onClick={compileContractHandler}
            disabled={editable || isLoading}
          >
            <span className="flex items-center justify-center gap-2">
            <Play className="w-5 h-5" />
            {isLoading ? "Deploying..." : "Deploy"}
            </span>
          </button>
          <button 
            className="px-4 py-2 rounded-lg bg-gray-500 hover:bg-gray-600 text-white transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-opacity-50"
            onClick={() => setEditable(!editable)}
            disabled={isLoading}
          >
            <span className="flex items-center justify-center gap-2 ">
            <Edit2 className="w-5 h-5" />
            {editable ? "Save" : "Edit"}
            </span>
          </button>
          <button 
            className={`px-4 py-2 rounded-lg ${
              editable || isLoading 
                ? 'bg-gray-500 cursor-not-allowed' 
                : 'bg-yellow-500 hover:bg-yellow-600 text-black font-bold transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-opacity-50' 
            }`}
            style={{
              boxShadow: "0 0 15px rgba(255, 255, 0, 0.3)",
            }}
            onClick={auditCodeHandler}
            disabled={editable || isLoading}
          >
            <span className="flex items-center justify-center gap-2">
            <Shield className="w-5 h-5" />
            Audit
            </span>
          </button>
          </div>
      </div>

      {/* Deployment Logs */}
      {logs.length > 0 && (
        <div className="mt-4">
          <h3 className="text-lg font-semibold mb-2">Deployment Logs</h3>
          <div 
            ref={logsContainerRef}
            className="bg-gray-900 text-gray-100 rounded-lg p-4 max-h-[200px] overflow-y-auto"
          >
            {logs.map((log, index) => (
              <div key={index} className="font-mono text-sm mb-1">
                {log}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deployment Result */}

      <AnimatePresence>
      {result && (
        <motion.div
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 100 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className={`sticky bottom-0 left-0 right-0 p-6 border mt-4 ${
          result.success ? "bg-green-900/95 border-green-700" : "bg-red-900/95 border-red-700"
        }`}
      >
          {result.success ? (
            <div className="flex flex-col gap-2">
              <div className="font-semibold text-white">
              <CheckCircle className="w-6 h-6" />
                Deployment Successful!
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">Transaction:</span>
                <a
                  href={`https://sepolia.starkscan.co/tx/${result.transactionHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  View on Starkscan
                  <ExternalLink size={14} />
                </a>
              </div>
              <div className="text-sm text-gray-600">
                <div className="mt-1">
                  <span className="font-medium">Contract Address:</span> {result.contractAddress}
                </div>
                <div className="mt-1">
                  <span className="font-medium">Class Hash:</span> {result.classHash}
                </div>
              </div>
            </div>
          ) : (
            <div className="">
              <div className="font-semibold text-xl flex items-center gap-2">
              <XCircle className="w-6 h-6" />
                Deployment Failed</div>
              <div className="text-sm mt-2">{result.error}</div>
              {result.details && (
                <div className="text-sm mt-2 text-white">{result.details}</div>
              )}
            </div>
          )}
        </motion.div>
      )}
      </AnimatePresence>
    </motion.div>
  );
};

export default ContractCode;